/**
 * PortalAttachmentsService — WO-089.
 *
 * Handles the portal-specific pre-ticket attachment upload workflow:
 *
 *   1. presign  — tenant-prefixed key `tenants/{tenantId}/attachments/{uuid}`,
 *                 pre-signed POST policy (5-min / 25 MB), pending row inserted
 *                 with ticketId = null.
 *   2. confirm  — ranged-GET first 4 KB, magic-byte detection, extension
 *                 cross-check, delete + reject on mismatch, finalize on pass.
 *
 * Security invariants:
 *   - Storage key NEVER derived from user input.
 *   - Filename sanitised before storage; only used as display_name.
 *   - Magic-byte detection is authoritative; client-declared Content-Type is
 *     stored for reference only.
 *   - Ownership check on confirm: tenant_id + organization_id + uploaded_by_user_id.
 *   - Idempotent confirm: already-confirmed row returns existing state.
 *   - Rejected objects are deleted before returning 422 to caller.
 *
 * Metrics (logged as structured fields; push to OTEL/Prometheus via log pipeline):
 *   portal_attachment_rejected_total  { reason }
 */

import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';

import { ticketAttachments } from '@opsninja/db';
import type { TicketAttachment } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { sanitiseFilename, extractExtension } from '../attachments/filename-sanitiser';
import { validateMimeAndExtension } from '../attachments/mime/magic-bytes';
import {
  OBJECT_STORE_PORT,
  type ObjectStorePort,
} from '../attachments/storage/object-store.port';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRESIGN_MAX_BYTES       = 25 * 1024 * 1024; // 25 MB
const PRESIGN_EXPIRY_SECONDS  = 300;              // 5 minutes
const MAGIC_BYTES_READ_LENGTH = 4096;             // 4 KB for MIME detection

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface PortalPresignInput {
  fileName:             string;
  declaredContentType:  string;
  sizeBytes:            number;
}

export interface PortalPresignResult {
  attachmentId: string;
  upload: {
    url:    string;
    fields: Record<string, string>;
  };
  expiresAt: string;
  maxBytes:  number;
}

export interface PortalConfirmResult {
  attachmentId:         string;
  displayName:          string;
  detectedContentType:  string;
  sizeBytes:            number;
  status:               'confirmed';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class PortalAttachmentsService extends TenantRepository {
  private readonly logger    = new Logger(PortalAttachmentsService.name);
  private readonly kmsKeyId  = process.env['S3_ATTACHMENTS_KMS_KEY_ID'] ?? 'alias/opsninja-attachments';

  constructor(
    @Inject(OBJECT_STORE_PORT) private readonly objectStore: ObjectStorePort,
  ) {
    super();
  }

  // --------------------------------------------------------------------------
  // presign
  // --------------------------------------------------------------------------

  async presign(
    tenantId:       string,
    userId:         string,
    organizationId: string,
    dto:            PortalPresignInput,
  ): Promise<PortalPresignResult> {
    // Sanitise filename — storage key is never derived from it
    const displayName = sanitiseFilename(dto.fileName);

    // Server-generated object key: tenants/{tenantId}/attachments/{uuid}
    const objectId = randomUUID();
    const key = `tenants/${tenantId}/attachments/${objectId}`;

    // Generate pre-signed POST policy (5-min expiry, 25 MB cap)
    const policy = await this.objectStore.presignPost(
      key,
      PRESIGN_MAX_BYTES,
      PRESIGN_EXPIRY_SECONDS,
      this.kmsKeyId,
    );

    // Insert pending attachment row (ticketId = null until ticket creation)
    const [row] = await this.tx
      .insert(ticketAttachments)
      .values({
        id:               randomUUID(),
        tenantId,
        ticketId:         null,
        organizationId,
        uploadedByUserId: userId,
        filename:         displayName,
        mimeType:         dto.declaredContentType,
        s3Key:            key,
        isFinalized:      false,
        createdAt:        new Date(),
      })
      .returning();

    if (!row) throw new Error('Attachment insert returned no rows');

    const expiresAt = new Date(Date.now() + PRESIGN_EXPIRY_SECONDS * 1000).toISOString();

    this.logger.log('Portal attachment presigned', {
      attachmentId: row.id,
      tenantId,
      organizationId,
      sizeHint: dto.sizeBytes,
      // key and URL excluded from logs
    });

    return {
      attachmentId: row.id,
      upload: { url: policy.url, fields: policy.fields },
      expiresAt,
      maxBytes: PRESIGN_MAX_BYTES,
    };
  }

  // --------------------------------------------------------------------------
  // confirm
  // --------------------------------------------------------------------------

  async confirm(
    tenantId:       string,
    userId:         string,
    organizationId: string,
    attachmentId:   string,
  ): Promise<PortalConfirmResult> {
    // Load the attachment with full ownership check (tenant + org + user)
    const row = await this.findPortalPendingAttachment(
      attachmentId,
      tenantId,
      organizationId,
      userId,
    );

    if (!row) {
      // Check for already-confirmed idempotency case
      const confirmed = await this.findPortalConfirmedAttachment(
        attachmentId,
        tenantId,
        organizationId,
        userId,
      );
      if (confirmed) {
        return {
          attachmentId:        confirmed.id,
          displayName:         confirmed.filename,
          detectedContentType: confirmed.detectedMime ?? confirmed.mimeType,
          sizeBytes:           confirmed.fileSizeBytes ?? 0,
          status:              'confirmed',
        };
      }
      throw new NotFoundException({
        error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found or already expired.' },
      });
    }

    // Check object exists in storage
    const head = await this.objectStore.headObject(row.s3Key);
    if (!head.exists) {
      throw new UnprocessableEntityException({
        error: {
          code:    'ATTACHMENT_NOT_UPLOADED',
          message: 'Object not found in storage. Complete the upload before confirming.',
        },
      });
    }

    // Reject zero-byte files
    if (head.contentLength === 0) {
      await this.objectStore.deleteObject(row.s3Key);
      await this.markRejected(attachmentId, tenantId);
      this.emitRejectionMetric(tenantId, 'ATTACHMENT_EMPTY');
      throw new UnprocessableEntityException({
        error: { code: 'ATTACHMENT_EMPTY', message: 'Zero-byte uploads are not permitted.' },
      });
    }

    // Read leading 4 KB for magic-byte detection
    const leadingBytes = await this.objectStore.getRange(row.s3Key, 0, MAGIC_BYTES_READ_LENGTH - 1);
    if (!leadingBytes || leadingBytes.length === 0) {
      await this.objectStore.deleteObject(row.s3Key);
      await this.markRejected(attachmentId, tenantId);
      this.emitRejectionMetric(tenantId, 'ATTACHMENT_UNREADABLE');
      throw new UnprocessableEntityException({
        error: { code: 'ATTACHMENT_UNREADABLE', message: 'Could not read attachment content.' },
      });
    }

    // Magic-byte validation against declared extension
    const ext       = extractExtension(row.filename);
    const mimeCheck = validateMimeAndExtension(leadingBytes, ext);

    if (!mimeCheck.allowed) {
      // Delete the uploaded object before rejecting — never retain bad content
      await this.objectStore.deleteObject(row.s3Key);
      await this.markRejected(attachmentId, tenantId);
      this.emitRejectionMetric(tenantId, mimeCheck.reason ?? 'EXTENSION_MISMATCH');

      const code = mimeCheck.reason === 'EXTENSION_BLOCKED'
        ? 'ATTACHMENT_TYPE_NOT_ALLOWED'
        : 'ATTACHMENT_TYPE_MISMATCH';

      throw new UnprocessableEntityException({
        error: {
          code,
          message: mimeCheck.reason === 'EXTENSION_BLOCKED'
            ? `Content type '${mimeCheck.detectedMime}' is not on the allow-list. ` +
              `Permitted types: PNG, JPEG, PDF, plain text, log, JSON/YAML/CSV, ZIP.`
            : `Content type mismatch: detected '${mimeCheck.detectedMime}' but ` +
              `extension '.${ext}' is not valid for that type.`,
          details: [{ detectedMime: mimeCheck.detectedMime, extension: ext }],
        },
      });
    }

    // Finalize the row
    const [finalized] = await this.tx
      .update(ticketAttachments)
      .set({
        isFinalized:   true,
        detectedMime:  mimeCheck.detectedMime,
        fileSizeBytes: head.contentLength ?? 0,
        finalizedAt:   new Date(),
      })
      .where(
        and(
          eq(ticketAttachments.id,       attachmentId),
          eq(ticketAttachments.tenantId, tenantId),
        ),
      )
      .returning();

    if (!finalized) {
      throw new NotFoundException({
        error: { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' },
      });
    }

    this.logger.log('Portal attachment confirmed', {
      attachmentId,
      tenantId,
      detectedMime:  mimeCheck.detectedMime,
      fileSizeBytes: head.contentLength,
    });

    return {
      attachmentId:        finalized.id,
      displayName:         finalized.filename,
      detectedContentType: finalized.detectedMime ?? finalized.mimeType,
      sizeBytes:           finalized.fileSizeBytes ?? 0,
      status:              'confirmed',
    };
  }

  // --------------------------------------------------------------------------
  // linkToTicket (called from TicketsService.createFromPortal)
  // --------------------------------------------------------------------------

  /**
   * Verify that all attachment IDs belong to the same tenant/org/user and are
   * confirmed, then link them to the newly created ticket ID.
   *
   * Returns 404 (existence-non-disclosing) for any violation.
   */
  async verifyAndLink(
    tenantId:       string,
    organizationId: string,
    userId:         string,
    attachmentIds:  string[],
    ticketId:       string,
  ): Promise<void> {
    if (attachmentIds.length === 0) return;

    for (const id of attachmentIds) {
      const row = await this.findPortalConfirmedAttachment(id, tenantId, organizationId, userId);
      if (!row) {
        throw new NotFoundException({
          error: {
            code:    'ATTACHMENT_NOT_FOUND',
            message: `Attachment ${id} not found, not confirmed, or belongs to a different request.`,
          },
        });
      }
      // Reject reuse — already linked to another ticket
      if (row.ticketId !== null) {
        throw new NotFoundException({
          error: {
            code:    'ATTACHMENT_NOT_FOUND',
            message: `Attachment ${id} is already attached to another ticket.`,
          },
        });
      }
    }

    // Bulk update: link attachments to the ticket
    for (const id of attachmentIds) {
      await this.tx
        .update(ticketAttachments)
        .set({ ticketId })
        .where(
          and(
            eq(ticketAttachments.id,       id),
            eq(ticketAttachments.tenantId, tenantId),
            isNull(ticketAttachments.ticketId),
          ),
        );
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async findPortalPendingAttachment(
    id:             string,
    tenantId:       string,
    organizationId: string,
    userId:         string,
  ): Promise<TicketAttachment | null> {
    const rows = await this.tx
      .select()
      .from(ticketAttachments)
      .where(
        and(
          eq(ticketAttachments.id,               id),
          eq(ticketAttachments.tenantId,         tenantId),
          eq(ticketAttachments.organizationId,   organizationId),
          eq(ticketAttachments.uploadedByUserId, userId),
          eq(ticketAttachments.isFinalized,      false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async findPortalConfirmedAttachment(
    id:             string,
    tenantId:       string,
    organizationId: string,
    userId:         string,
  ): Promise<TicketAttachment | null> {
    const rows = await this.tx
      .select()
      .from(ticketAttachments)
      .where(
        and(
          eq(ticketAttachments.id,               id),
          eq(ticketAttachments.tenantId,         tenantId),
          eq(ticketAttachments.organizationId,   organizationId),
          eq(ticketAttachments.uploadedByUserId, userId),
          eq(ticketAttachments.isFinalized,      true),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  private async markRejected(id: string, tenantId: string): Promise<void> {
    // For the portal flow we hard-delete the row so orphan reaper doesn't
    // pick it up again (the object is already deleted at this point).
    await this.tx
      .delete(ticketAttachments)
      .where(
        and(
          eq(ticketAttachments.id,       id),
          eq(ticketAttachments.tenantId, tenantId),
        ),
      );
  }

  private emitRejectionMetric(tenantId: string, reason: string): void {
    this.logger.log('[METRIC] portal_attachment_rejected_total', {
      metric:   'portal_attachment_rejected_total',
      tenantId,
      reason,
    });
  }
}
