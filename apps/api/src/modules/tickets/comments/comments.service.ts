/**
 * CommentsService — business logic for ticket comment creation and listing.
 *
 * Invariants:
 *   - Portal principals may only post public comments; internal visibility → 403.
 *   - Visibility enforcement on reads is in the repository predicate (non-bypassable).
 *   - first_response_at is stamped exactly once via conditional UPDATE in the repo.
 *   - ticket.comment_added outbox event is inserted in the same transaction.
 *   - Audit record is written in the same transaction.
 *   - Comment bodies are redacted from structured logs (Confidential-tier data).
 *   - All writes return 404 for unknown/out-of-scope ticket IDs (existence non-disclosure).
 */

import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { PrincipalContext } from '../../../observability/request-context';
import { isPortalPrincipal } from '../../identity/portal/portal-principal';
import { TicketRepository } from '../repositories/ticket.repository';
import { CommentRepository } from '../repositories/comment.repository';
import { mapToCommentDto, type CommentDto, type CommentPageDto } from './comment-response.dto';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly ticketRepo: TicketRepository,
    private readonly commentRepo: CommentRepository,
  ) {}

  // --------------------------------------------------------------------------
  // Create comment
  // --------------------------------------------------------------------------

  /**
   * Post a new comment on a ticket.
   *
   * Steps:
   *   1. Load ticket with scope enforcement → 404 if missing/out-of-scope.
   *   2. Portal principals may not comment on closed tickets → 422.
   *   3. Portal principals cannot post internal comments → 403.
   *   4. Insert comment row.
   *   5. If first public agent comment, conditionally stamp first_response_at.
   *   6. Emit ticket.comment_added outbox event in same transaction.
   *   7. Return CommentDto.
   */
  async create(
    principal: PrincipalContext,
    ticketId: string,
    dto: { body: string; visibility: string; attachment_ids?: string[] },
    traceId?: string,
  ): Promise<CommentDto> {
    const tenantId = principal.tenantId;
    const isPortal = isPortalPrincipal(principal);

    // ── 1. Load ticket (scope-enforced) ──────────────────────────────────────
    const ticket = await this.ticketRepo.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException({
        error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' },
      });
    }

    // ── 2. Portal cannot comment on closed tickets ───────────────────────────
    if (isPortal && ticket.status === 'closed') {
      throw new UnprocessableEntityException({
        error: {
          code: 'TICKET_CLOSED',
          message: 'Portal users cannot add comments to closed tickets.',
          details: [{ ticketId, status: ticket.status }],
        },
      });
    }

    // ── 3. Portal cannot post internal comments ──────────────────────────────
    if (isPortal && dto.visibility === 'internal') {
      throw new ForbiddenException({
        error: {
          code: 'PORTAL_INTERNAL_COMMENT_FORBIDDEN',
          message: 'Portal users may only post public comments.',
        },
      });
    }

    // Force portal visibility to public (defence-in-depth: already checked above)
    const effectiveVisibility = isPortal ? 'public' : dto.visibility;
    const isInternal = effectiveVisibility === 'internal';

    // ── 4. Insert comment ────────────────────────────────────────────────────
    const comment = await this.commentRepo.insert({
      tenantId,
      ticketId,
      organizationId: ticket.organizationId,
      authorId: principal.userId ?? null,
      body: dto.body,
      visibility: effectiveVisibility,
      isInternal,
    });

    this.logger.log('Comment created', {
      commentId: comment.id,
      ticketId,
      tenantId,
      visibility: effectiveVisibility,
      // body intentionally omitted — Confidential-tier data
    });

    // ── 5. Stamp first_response_at (public comments from non-portal only) ────
    // A public agent reply is the first-response signal for SLA purposes.
    if (!isPortal && effectiveVisibility === 'public') {
      const wasFirstResponse = await this.commentRepo.stampFirstResponseAt(tenantId, ticketId);
      if (wasFirstResponse) {
        this.logger.log('First response stamped', { ticketId, tenantId });
        // SlaPort.onFirstResponse would be called here when implemented (future WO)
      }
    }

    // ── 6. Outbox event ──────────────────────────────────────────────────────
    await this.commentRepo.emitCommentAddedEvent(
      tenantId,
      ticketId,
      comment.id,
      effectiveVisibility,
      principal.userId ?? null,
      traceId,
    );

    // ── 7. Return DTO ────────────────────────────────────────────────────────
    return mapToCommentDto(comment, []);
  }

  // --------------------------------------------------------------------------
  // List comments (paginated)
  // --------------------------------------------------------------------------

  /**
   * Return a cursor-paginated page of comments for a ticket.
   *
   * Visibility is enforced at the repository layer:
   *   - Portal: only public comments in the principal's boundOrganizationId.
   *   - Staff: all comments.
   *
   * Returns 404 for unknown or out-of-scope ticket IDs.
   */
  async listPage(
    principal: PrincipalContext,
    ticketId: string,
    cursor?: string,
    limit?: number,
  ): Promise<CommentPageDto> {
    // Confirm ticket exists and is in scope
    const ticket = await this.ticketRepo.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException({
        error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' },
      });
    }

    const { rows, nextCursor } = await this.commentRepo.findPageByTicketId(
      ticketId,
      cursor,
      limit,
    );

    return {
      data: rows.map((c) => mapToCommentDto(c)),
      next_cursor: nextCursor,
    };
  }
}
