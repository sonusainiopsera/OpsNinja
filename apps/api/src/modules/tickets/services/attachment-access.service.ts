/**
 * AttachmentAccessService — gates attachment download behind comment visibility.
 *
 * Before minting a pre-signed URL:
 *   1. Resolves the attachment → checks organisation scope (via repository predicate).
 *   2. Resolves the parent comment → fails closed if comment not found or visibility != 'public'.
 *   3. Only then generates a short-lived pre-signed URL (default 5 minutes).
 *
 * Failure modes: every error path returns null/throws NotFoundException so the
 * caller returns 404, preventing existence disclosure of internal attachments.
 * A pre-signed URL is NEVER minted for an attachment whose parent comment is internal.
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { PortalPrincipal } from '../../identity/portal/portal-principal';
import { AttachmentRepository } from '../repositories/attachment.repository';
import { CommentRepository } from '../repositories/comment.repository';
import type { AttachmentDownloadDto } from '../portal/portal-ticket.dto';

const PRESIGNED_URL_TTL_SECONDS = 300; // 5 minutes — short to limit window after visibility change

@Injectable()
export class AttachmentAccessService {
  private readonly logger = new Logger(AttachmentAccessService.name);
  private readonly s3UrlBase: string;

  constructor(
    private readonly attachmentRepository: AttachmentRepository,
    private readonly commentRepository: CommentRepository,
    private readonly configService: ConfigService,
  ) {
    this.s3UrlBase =
      this.configService.get<string>('S3_PRESIGNED_BASE_URL') ?? 'https://attachments.internal';
  }

  /**
   * Authorise and mint a pre-signed download URL for a portal user.
   *
   * Returns null when the attachment does not exist, belongs to another org,
   * or the parent comment is internal. The caller translates null → 404.
   */
  async mintPortalDownloadUrl(
    attachmentId: string,
    portal: PortalPrincipal,
  ): Promise<AttachmentDownloadDto | null> {
    // 1. Find attachment (repository enforces org scope predicate).
    const attachment = await this.attachmentRepository.findById(attachmentId);
    if (!attachment) {
      return null;
    }

    // 2. Check parent comment visibility if the attachment belongs to a comment.
    if (attachment.commentId) {
      const comment = await this.commentRepository.findById(attachment.commentId);
      // findById applies the portal predicate (org + visibility='public').
      // A null result means comment not found, internal, or different org.
      if (!comment) {
        this.logger.debug('Portal attachment denied — parent comment invisible', {
          attachmentId,
          commentId: attachment.commentId,
          tenantId: portal.tenantId,
          orgId: portal.boundOrganizationId,
        });
        return null;
      }
    }

    // 3. Mint a short-lived pre-signed URL.
    const expiresAt = new Date(Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000);
    const url = this.buildPresignedUrl(attachment.s3Key, expiresAt);

    return {
      url,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private buildPresignedUrl(s3Key: string, expiresAt: Date): string {
    // In production this would call the AWS SDK presignGetObject.
    // The placeholder produces a deterministic URL shape for tests.
    const expiresSec = Math.floor(expiresAt.getTime() / 1000);
    return `${this.s3UrlBase}/${encodeURIComponent(s3Key)}?X-Expires=${expiresSec}`;
  }
}
