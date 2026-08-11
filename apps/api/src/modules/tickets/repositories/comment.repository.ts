import { Injectable } from '@nestjs/common';
import { eq, and, comments } from '@opsninja/db';
import type { Comment, NewComment } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { portalCommentForTicketFilter } from '../../../common/db/scoped-query.helper';
import { Auditable } from '../../../common/audit/auditable.decorator';
import { AuditWriter } from '../../../common/audit/audit-writer';

@Injectable()
export class CommentRepository extends TenantRepository {
  constructor(private readonly auditWriter: AuditWriter) {
    super();
  }

  /** Returns all comments for a ticket (staff/internal use — no visibility filter). */
  async findAllForTicket(ticketId: string): Promise<Comment[]> {
    return this.db
      .select()
      .from(comments)
      .where(eq(comments.ticketId, ticketId));
  }

  /**
   * Returns only public comments for a ticket (portal use).
   * Applies the non-bypassable visibility predicate from portalCommentForTicketFilter.
   */
  async findPublicForTicket(ticketId: string): Promise<Comment[]> {
    return this.db
      .select()
      .from(comments)
      .where(portalCommentForTicketFilter(ticketId));
  }

  /** Returns a comment by ID without visibility filtering (for internal use). */
  async findById(id: string): Promise<Comment | undefined> {
    const rows = await this.db
      .select()
      .from(comments)
      .where(eq(comments.id, id));
    return rows[0];
  }

  @Auditable({ resourceType: 'comment', action: 'comment.created' })
  async createPublicComment(
    input: Pick<NewComment, 'ticketId' | 'authorId' | 'body' | 'tenantId'>,
  ): Promise<Comment> {
    const rows = await this.db
      .insert(comments)
      .values({ ...input, visibility: 'public' })
      .returning();
    const comment = rows[0]!;
    await this.auditWriter.append({
      action: 'comment.created',
      resourceType: 'comment',
      resourceId: comment.id,
      afterState: { ticketId: comment.ticketId, visibility: comment.visibility },
      forceEmit: true,
    });
    return comment;
  }

  @Auditable({ resourceType: 'comment', action: 'comment.created' })
  async createInternalComment(
    input: Pick<NewComment, 'ticketId' | 'authorId' | 'body' | 'tenantId'>,
  ): Promise<Comment> {
    const rows = await this.db
      .insert(comments)
      .values({ ...input, visibility: 'internal' })
      .returning();
    const comment = rows[0]!;
    await this.auditWriter.append({
      action: 'comment.created',
      resourceType: 'comment',
      resourceId: comment.id,
      afterState: { ticketId: comment.ticketId, visibility: comment.visibility },
      forceEmit: true,
    });
    return comment;
  }

  /** Returns all comments for a ticket where visibility matches the given value (staff use). */
  async findByTicketAndVisibility(
    ticketId: string,
    visibility: 'public' | 'internal',
  ): Promise<Comment[]> {
    return this.db
      .select()
      .from(comments)
      .where(and(eq(comments.ticketId, ticketId), eq(comments.visibility, visibility)));
  }
}
