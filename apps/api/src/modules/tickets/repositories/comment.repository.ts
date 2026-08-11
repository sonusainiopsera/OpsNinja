import { Injectable } from '@nestjs/common';
import { and, eq, or, gt, sql } from 'drizzle-orm';

import { ticketComments, tickets, outboxEvents, type TicketComment } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { getPrincipalContext } from '../../../observability/request-context';
import { isPortalPrincipal } from '../../identity/portal/portal-principal';
import { portalCommentPredicate } from '../../../common/db/scoped-query.helper';
import { Auditable } from '../../audit/auditable.decorator';
import { AuditWriter } from '../../audit/audit-writer';
import { AuditCoverageRegistry } from '../../audit/audit-coverage.registry';
import { encodeCommentCursor, decodeCommentCursor } from '../comments/comment-cursor';
import type { CommentPageDto } from '../comments/comment-response.dto';

@Injectable()
export class CommentRepository extends TenantRepository {
  constructor(private readonly auditWriter: AuditWriter) {
    super();
    AuditCoverageRegistry.registerClass(CommentRepository.prototype);
  }

  /**
   * Find all comments for a ticket, applying portal visibility predicate when
   * the caller is a portal principal. This is the single enforcement point for
   * public-only visibility — the predicate is non-bypassable.
   *
   * @deprecated Prefer findPageByTicketId for paginated responses.
   */
  async findByTicketId(ticketId: string): Promise<TicketComment[]> {
    const principal = getPrincipalContext();
    const baseWhere = eq(ticketComments.ticketId, ticketId);
    const where = isPortalPrincipal(principal)
      ? and(baseWhere, portalCommentPredicate(principal))
      : baseWhere;

    return this.tx.select().from(ticketComments).where(where);
  }

  /**
   * Cursor-paginated comment list for a ticket.
   *
   * Ordered by (created_at ASC, id ASC) — append-stable.
   * Portal principals receive only public comments (enforced by predicate).
   * Limit is capped at 100.
   *
   * @param ticketId  The ticket whose comments to fetch.
   * @param cursor    Opaque base64url cursor from a previous page.
   * @param limit     Page size, capped at 100.
   */
  async findPageByTicketId(
    ticketId: string,
    cursor?: string,
    limit: number = 50,
  ): Promise<{ rows: TicketComment[]; nextCursor: string | null }> {
    const principal = getPrincipalContext();
    const effectiveLimit = Math.min(Math.max(1, limit), 100);

    // Base predicate: tenant + ticket
    let where = eq(ticketComments.ticketId, ticketId);

    // Portal visibility enforcement — non-bypassable
    if (isPortalPrincipal(principal)) {
      where = and(where, portalCommentPredicate(principal))!;
    }

    // Keyset cursor: WHERE (created_at, id) > (cursor.createdAt, cursor.id)
    if (cursor) {
      const pos = decodeCommentCursor(cursor);
      const cursorDate = new Date(pos.createdAt);
      where = and(
        where,
        or(
          gt(ticketComments.createdAt, cursorDate),
          and(
            eq(ticketComments.createdAt, cursorDate),
            gt(ticketComments.id, pos.id),
          ),
        ),
      )!;
    }

    const rows = await this.tx
      .select()
      .from(ticketComments)
      .where(where)
      .orderBy(ticketComments.createdAt, ticketComments.id)
      .limit(effectiveLimit + 1); // fetch one extra to determine if there's a next page

    const hasNextPage = rows.length > effectiveLimit;
    const pageRows = hasNextPage ? rows.slice(0, effectiveLimit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasNextPage && lastRow
        ? encodeCommentCursor(lastRow.createdAt, lastRow.id)
        : null;

    return { rows: pageRows, nextCursor };
  }

  /**
   * Find a single comment by ID. Portal principals see only public comments
   * in their organisation; out-of-scope or internal comments return null (→ 404).
   */
  async findById(id: string): Promise<TicketComment | null> {
    const principal = getPrincipalContext();
    const baseWhere = eq(ticketComments.id, id);
    const where = isPortalPrincipal(principal)
      ? and(baseWhere, portalCommentPredicate(principal))
      : baseWhere;

    const rows = await this.tx.select().from(ticketComments).where(where).limit(1);
    return rows[0] ?? null;
  }

  @Auditable({ resourceType: 'ticket_comment', action: 'create' })
  async insert(
    data: Omit<typeof ticketComments.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<TicketComment> {
    const rows = await this.tx.insert(ticketComments).values(data).returning();
    const created = rows[0]!;

    await this.auditWriter.append({
      resourceType: 'ticket_comment',
      action: 'create',
      resourceId: created.id,
      // body excluded from audit log — Confidential-tier data
      afterState: {
        id: created.id,
        ticketId: created.ticketId,
        authorId: created.authorId,
        visibility: created.visibility,
        tenantId: created.tenantId,
      },
    });

    return created;
  }

  /**
   * Conditionally stamp first_response_at on the ticket when it is still NULL.
   *
   * Uses UPDATE ... WHERE first_response_at IS NULL so concurrent public replies
   * from two agents produce exactly one stamp — the second UPDATE matches zero
   * rows and is a no-op.
   *
   * Returns true when this call was the one that stamped it (rowCount === 1),
   * false when already stamped (rowCount === 0). The caller uses this to decide
   * whether to notify the SLA port.
   */
  async stampFirstResponseAt(tenantId: string, ticketId: string): Promise<boolean> {
    const result = await this.tx
      .update(tickets)
      .set({ firstResponseAt: sql`now()` })
      .where(
        and(
          eq(tickets.tenantId, tenantId),
          eq(tickets.id, ticketId),
          sql`${tickets.firstResponseAt} IS NULL`,
        ),
      )
      .returning({ id: tickets.id });

    return result.length > 0;
  }

  /**
   * Insert a ticket.comment_added outbox event in the current transaction.
   * Payload is minimal so consumers re-read for content (Confidential-tier body).
   */
  async emitCommentAddedEvent(
    tenantId: string,
    ticketId: string,
    commentId: string,
    visibility: string,
    actorUserId: string | null,
    traceId?: string,
  ): Promise<void> {
    await this.tx.insert(outboxEvents).values({
      tenantId,
      aggregateType: 'ticket',
      aggregateId: ticketId,
      eventType: 'ticket.comment_added',
      payload: {
        commentId,
        ticketId,
        tenantId,
        visibility,
        actorUserId,
        // body intentionally excluded — consumers re-read for Confidential content
      },
      traceId: traceId ?? null,
      status: 'pending',
    });
  }
}
