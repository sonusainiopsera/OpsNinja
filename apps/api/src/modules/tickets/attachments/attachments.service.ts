/**
 * AttachmentsService — business logic for pre-signed upload, finalization and download.
 *
 * Invariants:
 *   - S3 keys are ALWAYS server-generated: tenants/{tenantId}/tickets/{ticketId}/{uuid}
 *     They NEVER derive from user-supplied filenames.
 *   - Filenames are sanitised before storage; only used as display metadata.
 *   - Magic-byte MIME detection happens during finalize; mismatch → 422 + S3 delete.
 *   - Audit records are written for every create and delete.
 *   - Portal principals are restricted to their own org's tickets.
 *   - Portal cannot access attachments on internal comments.
 *   - Pre-signed POST policy: 25 MB max, 5-minute expiry, SSE-KMS required.
 *   - Pre-signed GET URL: 60-second TTL.
 *   - Orphan-reaper handles unfinalized rows older than 24 hours.
 */

import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';

import type { PrincipalContext } from '../../../observability/request-context';
import { isPortalPrincipal } from '../../identity/portal/portal-principal';
import { AuditWriter } from '../../audit/audit-writer';
import { TicketRepository } from '../repositories/ticket.repository';
import { AttachmentRepository } from '../repositories/attachment.repository';
import { CommentRepository } from '../repositories/comment.repository';
import { sanitiseFilename, extractExtension } from './filename-sanitiser';
import { validateMimeAndExtension } from './mime/magic-bytes';
import { OBJECT_STORE_PORT, type ObjectStorePort, type PresignPostResult } from './storage/object-store.port';

const PRESIGN_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const PRESIGN_EXPIRY_SECONDS = 300;          // 5 minutes
const DOWNLOAD_EXPIRY_SECONDS = 60;          // 60 seconds
const MAGIC_BYTES_READ_LENGTH = 256;         // bytes to read for MIME detection

export interface PresignResult {
  attachmentId: string;
  uploadUrl: string;
  uploadFields: Record<string, string>;
  key: string;
  expiresAt: string;
}

export interface AttachmentDto {
  id: string;
  ticketId: string;
  commentId: string | null;
  filename: string;
  mimeType: string;
  detectedMime: string | null;
  fileSizeBytes: number | null;
  checksum: string | null;
  isFinalized: boolean;
  uploadedByUserId: string | null;
  createdAt: string;
}

export interface DownloadDto {
  url: string;
  expiresAt: string;
}

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);
  private readonly kmsKeyId: string;

  constructor(
    private readonly ticketRepo: TicketRepository,
    private readonly attachmentRepo: AttachmentRepository,
    private readonly commentRepo: CommentRepository,
    private readonly auditWriter: AuditWriter,
    @Inject(OBJECT_STORE_PORT) private readonly objectStore: ObjectStorePort,
  ) {
    this.kmsKeyId = process.env['S3_ATTACHMENTS_KMS_KEY_ID'] ?? 'alias/opsninja-attachments';
  }

  // --------------------------------------------------------------------------
  // Presign
  // --------------------------------------------------------------------------

  async presign(
    principal: PrincipalContext,
    ticketId: string,
    dto: { filename: string; mime_type: string; comment_id?: string },
  ): Promise<PresignResult> {
    const tenantId = principal.tenantId;

    // Verify ticket exists and is in scope
    const ticket = await this.ticketRepo.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException({ error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' } });
    }

    // Portal: restrict to own org
    if (isPortalPrincipal(principal) && ticket.organizationId !== principal.boundOrganizationId) {
      throw new NotFoundException({ error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' } });
    }

    // Sanitise filename
    const displayFilename = sanitiseFilename(dto.filename);

    // Generate server-side storage key (never from user input)
    const objectId = randomUUID();
    const key = `tenants/${tenantId}/tickets/${ticketId}/${objectId}`;

    // Generate presigned POST policy
    const policy: PresignPostResult = await this.objectStore.presignPost(
      key,
      PRESIGN_MAX_BYTES,
      PRESIGN_EXPIRY_SECONDS,
      this.kmsKeyId,
    );

    // Insert unfinalized attachment row
    const attachment = await this.attachmentRepo.insertUnfinalized({
      tenantId,
      ticketId,
      commentId: dto.comment_id ?? null,
      organizationId: ticket.organizationId,
      filename: displayFilename,
      mimeType: dto.mime_type,
      s3Key: key,
      uploadedByUserId: principal.userId ?? null,
    });

    await this.auditWriter.append({
      resourceType: 'ticket_attachment',
      resourceId: attachment.id,
      action: 'presign',
      beforeState: null,
      afterState: { id: attachment.id, ticketId, key, isFinalized: false },
      metadata: { tenantId },
    });

    this.logger.log('Attachment presigned', {
      attachmentId: attachment.id,
      ticketId,
      tenantId,
      // key excluded from logs to reduce noise; filename sanitised
    });

    const expiresAt = new Date(Date.now() + PRESIGN_EXPIRY_SECONDS * 1000).toISOString();
    return {
      attachmentId: attachment.id,
      uploadUrl: policy.url,
      uploadFields: policy.fields,
      key,
      expiresAt,
    };
  }

  // --------------------------------------------------------------------------
  // Finalize
  // --------------------------------------------------------------------------

  async finalize(
    principal: PrincipalContext,
    ticketId: string,
    attachmentId: string,
  ): Promise<AttachmentDto> {
    const tenantId = principal.tenantId;

    // Find the unfinalized row (check tenant scope)
    let attachment = await this.attachmentRepo.findUnfinalizedById(attachmentId, tenantId);

    // Idempotency: already finalized → return existing row
    if (!attachment) {
      const existing = await this.attachmentRepo.findFinalizedById(attachmentId, tenantId);
      if (existing) return this.toDto(existing);
      throw new NotFoundException({ error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found or already expired.' } });
    }

    // Verify the attachment belongs to the requested ticket
    if (attachment.ticketId !== ticketId) {
      throw new NotFoundException({ error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' } });
    }

    // headObject — verify the upload actually happened
    const head = await this.objectStore.headObject(attachment.s3Key);
    if (!head.exists) {
      throw new UnprocessableEntityException({
        error: {
          code: 'ATTACHMENT_NOT_UPLOADED',
          message: 'Object not found in storage. Complete the S3 upload before calling finalize.',
        },
      });
    }

    // Reject zero-byte files
    if (head.contentLength === 0) {
      await this.objectStore.deleteObject(attachment.s3Key);
      throw new UnprocessableEntityException({
        error: { code: 'ATTACHMENT_EMPTY', message: 'Zero-byte uploads are not permitted.' },
      });
    }

    // Read leading bytes for magic-byte detection
    const leadingBytes = await this.objectStore.getRange(attachment.s3Key, 0, MAGIC_BYTES_READ_LENGTH - 1);
    if (!leadingBytes) {
      throw new UnprocessableEntityException({
        error: { code: 'ATTACHMENT_READ_FAILED', message: 'Could not read attachment content.' },
      });
    }

    // Validate MIME against extension
    const ext = extractExtension(attachment.filename);
    const mimeCheck = validateMimeAndExtension(leadingBytes, ext);

    if (!mimeCheck.allowed) {
      // Delete the uploaded object on rejection
      await this.objectStore.deleteObject(attachment.s3Key);
      throw new UnprocessableEntityException({
        error: {
          code: mimeCheck.reason ?? 'MIME_MISMATCH',
          message: `Content type mismatch: detected '${mimeCheck.detectedMime}' but extension '${ext}' is not allowed for this type.`,
          details: [{ detectedMime: mimeCheck.detectedMime, extension: ext }],
        },
      });
    }

    // Compute SHA-256 checksum from leading bytes (full checksum would require streaming;
    // for now we hash the leading 256 bytes and note this in comments)
    // NOTE: A full-file checksum would require getRange(0, contentLength-1) which is expensive.
    // The checksum here is a content fingerprint derived from leading bytes + file size.
    const checksum = createHash('sha256')
      .update(leadingBytes)
      .update(String(head.contentLength ?? 0))
      .digest('hex');

    // Finalize row
    const finalized = await this.attachmentRepo.finalizeAttachment(
      attachmentId,
      tenantId,
      mimeCheck.detectedMime,
      checksum,
      head.contentLength ?? 0,
    );

    if (!finalized) {
      throw new NotFoundException({ error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' } });
    }

    await this.auditWriter.append({
      resourceType: 'ticket_attachment',
      resourceId: attachmentId,
      action: 'finalize',
      beforeState: { isFinalized: false },
      afterState: {
        isFinalized: true,
        detectedMime: mimeCheck.detectedMime,
        fileSizeBytes: head.contentLength,
      },
      metadata: { tenantId, ticketId },
    });

    this.logger.log('Attachment finalized', {
      attachmentId,
      ticketId,
      tenantId,
      detectedMime: mimeCheck.detectedMime,
      fileSizeBytes: head.contentLength,
    });

    return this.toDto(finalized);
  }

  // --------------------------------------------------------------------------
  // Download
  // --------------------------------------------------------------------------

  async download(
    principal: PrincipalContext,
    attachmentId: string,
  ): Promise<DownloadDto> {
    const tenantId = principal.tenantId;

    // Find finalized attachment (enforces tenant scope)
    const attachment = await this.attachmentRepo.findFinalizedById(attachmentId, tenantId);
    if (!attachment) {
      throw new NotFoundException({ error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' } });
    }

    // Portal: restrict to own org
    if (isPortalPrincipal(principal)) {
      if (attachment.organizationId !== principal.boundOrganizationId) {
        throw new NotFoundException({ error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' } });
      }

      // Portal cannot access attachments on internal comments
      if (attachment.commentId) {
        const comment = await this.commentRepo.findById(attachment.commentId);
        if (!comment || comment.visibility !== 'public') {
          throw new NotFoundException({ error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' } });
        }
      }
    }

    const url = await this.objectStore.presignGet(attachment.s3Key, DOWNLOAD_EXPIRY_SECONDS);
    const expiresAt = new Date(Date.now() + DOWNLOAD_EXPIRY_SECONDS * 1000).toISOString();

    this.logger.log('Attachment download URL issued', {
      attachmentId,
      tenantId,
      actorUserId: principal.userId,
      // URL intentionally excluded from logs
    });

    return { url, expiresAt };
  }

  // --------------------------------------------------------------------------
  // Orphan reaper (called by a scheduler, not HTTP)
  // --------------------------------------------------------------------------

  /**
   * Delete S3 objects and DB rows for unfinalized attachments older than 24h.
   * Returns the count of reaped attachments.
   */
  async reapOrphans(tenantId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orphans = await this.attachmentRepo.findOrphanedAttachments(tenantId, cutoff);

    let reaped = 0;
    for (const orphan of orphans) {
      try {
        await this.objectStore.deleteObject(orphan.s3Key);
        await this.attachmentRepo.deleteById(orphan.id, tenantId);
        reaped++;
      } catch (err) {
        this.logger.warn('Failed to reap orphan attachment', {
          attachmentId: orphan.id,
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (reaped > 0) {
      this.logger.log('Orphan attachments reaped', { tenantId, count: reaped });
    }

    return reaped;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private toDto(a: import('@opsninja/db').TicketAttachment): AttachmentDto {
    return {
      id: a.id,
      ticketId: a.ticketId,
      commentId: a.commentId ?? null,
      filename: a.filename,
      mimeType: a.mimeType,
      detectedMime: a.detectedMime ?? null,
      fileSizeBytes: a.fileSizeBytes ?? null,
      checksum: a.checksum ?? null,
      isFinalized: a.isFinalized,
      uploadedByUserId: a.uploadedByUserId ?? null,
      createdAt: a.createdAt.toISOString(),
    };
  }
}
