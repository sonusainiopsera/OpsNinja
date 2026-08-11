/**
 * AttachmentAccessService — resolves attachment download authorisation for portal callers.
 *
 * Authorisation chain (all steps must pass; any failure → 404):
 *   1. Attachment exists within tenant
 *   2. Parent comment has visibility = 'public'
 *   3. Parent ticket belongs to the portal principal's bound organisation
 *   4. Only then: mint a short-lived pre-signed URL (5-minute TTL)
 *
 * The chain fails closed: any error or missing row returns 404, never 403, to
 * avoid existence disclosure.  No URL is minted unless all three checks pass.
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AttachmentRepository } from '../repositories/attachment.repository';
import { CommentRepository } from '../repositories/comment.repository';
import { TicketRepository } from '../repositories/ticket.repository';
import type { PortalPrincipal } from '../../identity/portal/portal-principal';
import type { PortalAttachmentDownloadDto } from '../portal/portal-ticket.dto';

/** Pre-signed URL TTL in seconds (must be short per WO constraint). */
const PRESIGNED_URL_TTL_S = 5 * 60;

@Injectable()
export class AttachmentAccessService {
  private readonly logger = new Logger(AttachmentAccessService.name);

  constructor(
    private readonly attachmentRepo: AttachmentRepository,
    private readonly commentRepo: CommentRepository,
    private readonly ticketRepo: TicketRepository,
  ) {}

  /**
   * Authorises and mints a download URL for a portal principal.
   *
   * @throws NotFoundException for any failure (attachment missing, internal comment,
   *   out-of-org ticket) to prevent existence disclosure.
   */
  async getDownloadUrl(
    attachmentId: string,
    principal: PortalPrincipal,
  ): Promise<PortalAttachmentDownloadDto> {
    // Step 1: attachment must exist within tenant
    const attachment = await this.attachmentRepo.findById(attachmentId);
    if (!attachment) {
      throw new NotFoundException();
    }

    // Step 2: parent comment must have visibility = 'public'
    const comment = await this.commentRepo.findById(attachment.commentId);
    if (!comment || comment.visibility !== 'public') {
      // 404, not 403, to avoid disclosing that an internal attachment exists
      this.logger.log({
        event: 'portal.attachment_access.denied',
        attachmentId,
        commentId: attachment.commentId,
        reason: !comment ? 'comment_not_found' : 'comment_internal',
        actorId: principal.userId,
        tenantId: principal.tenantId,
        traceId: principal.traceId,
      });
      throw new NotFoundException();
    }

    // Step 3: parent ticket must belong to the portal principal's bound org
    const ticket = await this.ticketRepo.findOneForPortal(comment.ticketId, principal);
    if (!ticket) {
      this.logger.log({
        event: 'portal.attachment_access.denied',
        attachmentId,
        ticketId: comment.ticketId,
        reason: 'ticket_out_of_org',
        actorId: principal.userId,
        tenantId: principal.tenantId,
        boundOrg: principal.boundOrganizationId,
        traceId: principal.traceId,
      });
      throw new NotFoundException();
    }

    // Step 4: mint a short-lived URL — only reached when all checks pass
    const expiresAt = new Date(Date.now() + PRESIGNED_URL_TTL_S * 1000);
    const url = this.mintPresignedUrl(attachment.s3Key, expiresAt);

    return { url, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Builds a pre-signed download URL for the given S3 key.
   *
   * Production: replace with `s3.getSignedUrlPromise('getObject', { ... })`.
   * The implementation is intentionally injectable/overridable in tests.
   */
  protected mintPresignedUrl(s3Key: string, expiresAt: Date): string {
    const expiry = Math.floor(expiresAt.getTime() / 1000);
    return `https://assets.opsninja.io/${encodeURIComponent(s3Key)}?exp=${expiry}&sig=placeholder`;
  }
}
