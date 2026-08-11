import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { ticketComments, type TicketComment } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { getPrincipalContext } from '../../../observability/request-context';
import { isPortalPrincipal } from '../../identity/portal/portal-principal';
import { portalCommentPredicate } from '../../../common/db/scoped-query.helper';
import { Auditable } from '../../audit/auditable.decorator';
import { AuditWriter } from '../../audit/audit-writer';
import { AuditCoverageRegistry } from '../../audit/audit-coverage.registry';

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
      afterState: created as unknown as Record<string, unknown>,
    });

    return created;
  }
}
