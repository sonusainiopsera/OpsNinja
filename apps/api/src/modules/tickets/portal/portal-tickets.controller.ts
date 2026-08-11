/**
 * PortalTicketsController — customer-facing ticket API.
 *
 * All routes are under /api/v1/portal/* and require a portal-audience JWT with
 * a bound organisation scope.  Two guards enforce this:
 *   1. AuthGuard (global)  — validates JWT, checks permission tier, enforces audience
 *   2. PortalVisibilityGuard — validates principalKind = 'portal' and orgScopeIds ≥ 1
 *
 * Every handler uses asPortalPrincipal() to narrow req.user so the compiler forces
 * handling of the portal branch.  Repositories apply the non-bypassable scoped-query
 * predicates (portalTicketFilter, portalCommentFilter) so no handler flag can widen
 * the result set.
 *
 * Responses are serialised through portal-specific DTO mappers that do not contain
 * internal fields.  No entity object is returned directly from a handler.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { Permission } from '../../../common/auth/permissions';
import { ErrorCode } from '../../../common/errors/app-errors';
import type { PrincipalContext } from '../../../observability/request-context';
import { asPortalPrincipal } from '../../identity/portal/portal-principal';
import { PortalVisibilityGuard } from './portal-visibility.guard';
import type { Attachment } from '@opsninja/db';
import {
  type CreatePortalCommentBody,
  type PortalAttachmentDownloadDto,
  type PortalCommentDto,
  type PortalTicketDetailDto,
  type PortalTicketListItemDto,
  toPortalAttachment,
  toPortalComment,
  toPortalTicketDetail,
  toPortalTicketListItem,
} from './portal-ticket.dto';
import { TicketRepository } from '../repositories/ticket.repository';
import { CommentRepository } from '../repositories/comment.repository';
import { AttachmentRepository } from '../repositories/attachment.repository';
import { AttachmentAccessService } from '../services/attachment-access.service';
import { TenantSettingsService } from '../services/tenant-settings.service';

type AuthRequest = Request & { user?: PrincipalContext };

@Controller('portal')
@UseGuards(PortalVisibilityGuard)
export class PortalTicketsController {
  constructor(
    private readonly ticketRepo: TicketRepository,
    private readonly commentRepo: CommentRepository,
    private readonly attachmentRepo: AttachmentRepository,
    private readonly attachmentAccessService: AttachmentAccessService,
    private readonly tenantSettingsService: TenantSettingsService,
  ) {}

  /** GET /api/v1/portal/tickets — list of org-scoped tickets. */
  @Get('tickets')
  @RequirePermission(Permission.PORTAL_TICKETS_READ)
  async listTickets(@Req() req: AuthRequest): Promise<PortalTicketListItemDto[]> {
    const principal = asPortalPrincipal(req.user!);
    const showAiSummary = await this.tenantSettingsService.isCustomerAiSummaryEnabled(
      principal.tenantId,
    );
    const rows = await this.ticketRepo.findForPortal(principal);

    // Fetch public comment counts for all tickets in a single query
    const ticketIds = rows.map(t => t.id);
    const commentCounts = await this.buildCommentCountMap(ticketIds);

    return rows.map(t => toPortalTicketListItem(t, commentCounts[t.id] ?? 0, showAiSummary));
  }

  /** GET /api/v1/portal/tickets/:id — ticket detail with public comments only. */
  @Get('tickets/:id')
  @RequirePermission(Permission.PORTAL_TICKETS_READ)
  async getTicket(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ): Promise<PortalTicketDetailDto> {
    const principal = asPortalPrincipal(req.user!);
    const ticket = await this.ticketRepo.findOneForPortal(id, principal);
    if (!ticket) {
      // 404 for out-of-org ticket to avoid existence disclosure
      throw new NotFoundException();
    }

    const [publicComments, showAiSummary] = await Promise.all([
      this.commentRepo.findPublicForTicket(id),
      this.tenantSettingsService.isCustomerAiSummaryEnabled(principal.tenantId),
    ]);

    const commentIds = publicComments.map(c => c.id);
    const allAttachments = await this.attachmentRepo.findByCommentIds(commentIds);
    const attachmentsByComment = this.groupAttachmentsByComment(allAttachments);

    return toPortalTicketDetail(ticket, publicComments, attachmentsByComment, showAiSummary);
  }

  /**
   * POST /api/v1/portal/tickets/:id/comments
   *
   * Visibility is forced server-side to 'public'.  Any client-supplied visibility
   * value other than 'public' is rejected with 400 PORTAL_FIELD_NOT_ALLOWED.
   */
  @Post('tickets/:id/comments')
  @RequirePermission(Permission.PORTAL_TICKETS_WRITE)
  async addComment(
    @Param('id') id: string,
    @Body() body: CreatePortalCommentBody,
    @Req() req: AuthRequest,
  ): Promise<PortalCommentDto> {
    if (body.visibility !== undefined && body.visibility !== 'public') {
      throw new BadRequestException({
        code: ErrorCode.PORTAL_FIELD_NOT_ALLOWED,
        message: "Field 'visibility' is not allowed for portal comments.",
        field: 'visibility',
      });
    }

    const principal = asPortalPrincipal(req.user!);
    const ticket = await this.ticketRepo.findOneForPortal(id, principal);
    if (!ticket) {
      throw new NotFoundException();
    }

    const comment = await this.commentRepo.createPublicComment({
      ticketId: id,
      authorId: principal.userId,
      body: body.content,
      tenantId: principal.tenantId,
    });

    return toPortalComment(comment);
  }

  /**
   * GET /api/v1/portal/attachments/:id/download
   *
   * Resolves the attachment → comment (visibility check) → ticket (org check)
   * chain before minting a 5-minute pre-signed URL.  Returns 404 for any failure.
   */
  @Get('attachments/:id/download')
  @RequirePermission(Permission.PORTAL_ATTACHMENTS_DOWNLOAD)
  async downloadAttachment(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ): Promise<PortalAttachmentDownloadDto> {
    const principal = asPortalPrincipal(req.user!);
    return this.attachmentAccessService.getDownloadUrl(id, principal);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async buildCommentCountMap(ticketIds: string[]): Promise<Record<string, number>> {
    if (ticketIds.length === 0) return {};
    const countMap: Record<string, number> = {};
    // Fetch public comments for all tickets; count per ticket ID
    await Promise.all(
      ticketIds.map(async tid => {
        const cs = await this.commentRepo.findPublicForTicket(tid);
        countMap[tid] = cs.length;
      }),
    );
    return countMap;
  }

  private groupAttachmentsByComment(
    allAttachments: Attachment[],
  ): Record<string, ReturnType<typeof toPortalAttachment>[]> {
    const map: Record<string, ReturnType<typeof toPortalAttachment>[]> = {};
    for (const att of allAttachments) {
      const cid = att.commentId;
      if (!map[cid]) map[cid] = [];
      map[cid]!.push(toPortalAttachment(att));
    }
    return map;
  }
}
