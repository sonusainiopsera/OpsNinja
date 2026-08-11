import { Injectable } from '@nestjs/common';
import { eq, and, tickets } from '@opsninja/db';
import type { Ticket, NewTicket } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { portalTicketFilter } from '../../../common/db/scoped-query.helper';
import type { PortalPrincipal } from '../../identity/portal/portal-principal';
import { Auditable } from '../../../common/audit/auditable.decorator';
import { AuditWriter } from '../../../common/audit/audit-writer';

@Injectable()
export class TicketRepository extends TenantRepository {
  constructor(private readonly auditWriter: AuditWriter) {
    super();
  }

  /** Returns all tickets visible to a portal principal (org-scoped). */
  async findForPortal(principal: PortalPrincipal): Promise<Ticket[]> {
    return this.db
      .select()
      .from(tickets)
      .where(portalTicketFilter(principal));
  }

  /** Returns one ticket by ID, only if it belongs to the portal principal's org. */
  async findOneForPortal(id: string, principal: PortalPrincipal): Promise<Ticket | undefined> {
    const rows = await this.db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, id), portalTicketFilter(principal)));
    return rows[0];
  }

  /** Returns one ticket by ID within the current tenant (staff / internal use). */
  async findById(id: string): Promise<Ticket | undefined> {
    const rows = await this.db
      .select()
      .from(tickets)
      .where(eq(tickets.id, id));
    return rows[0];
  }

  @Auditable({ resourceType: 'ticket', action: 'ticket.created' })
  async createTicket(input: NewTicket): Promise<Ticket> {
    const rows = await this.db.insert(tickets).values(input).returning();
    const ticket = rows[0]!;
    await this.auditWriter.append({
      action: 'ticket.created',
      resourceType: 'ticket',
      resourceId: ticket.id,
      afterState: ticketSnapshot(ticket),
      forceEmit: true,
    });
    return ticket;
  }

  @Auditable({ resourceType: 'ticket', action: 'ticket.updated', stateFields: ['status', 'priority', 'assigneeId', 'subject'] })
  async updateTicket(
    id: string,
    patch: Partial<Pick<Ticket, 'subject' | 'description' | 'status' | 'priority' | 'assigneeId' | 'resolvedAt'>>,
  ): Promise<Ticket | undefined> {
    const before = await this.findById(id);
    if (!before) return undefined;

    const rows = await this.db
      .update(tickets)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(tickets.id, id))
      .returning();
    const after = rows[0];
    if (!after) return undefined;

    await this.auditWriter.append({
      action: 'ticket.updated',
      resourceType: 'ticket',
      resourceId: id,
      beforeState: ticketSnapshot(before),
      afterState: ticketSnapshot(after),
    });
    return after;
  }

  @Auditable({ resourceType: 'ticket', action: 'ticket.assigned', stateFields: ['assigneeId'] })
  async assignTicket(id: string, assigneeId: string | null): Promise<Ticket | undefined> {
    const before = await this.findById(id);
    if (!before) return undefined;

    const rows = await this.db
      .update(tickets)
      .set({ assigneeId, updatedAt: new Date() })
      .where(eq(tickets.id, id))
      .returning();
    const after = rows[0];
    if (!after) return undefined;

    await this.auditWriter.append({
      action: 'ticket.assigned',
      resourceType: 'ticket',
      resourceId: id,
      beforeState: { assigneeId: before.assigneeId },
      afterState: { assigneeId: after.assigneeId },
    });
    return after;
  }

  @Auditable({ resourceType: 'ticket', action: 'ticket.status_changed', stateFields: ['status'] })
  async transitionStatus(id: string, status: Ticket['status']): Promise<Ticket | undefined> {
    const before = await this.findById(id);
    if (!before) return undefined;

    const patch: Partial<Ticket> = { status, updatedAt: new Date() };
    if (status === 'resolved' || status === 'closed') {
      (patch as Record<string, unknown>).resolvedAt = new Date();
    }

    const rows = await this.db
      .update(tickets)
      .set(patch)
      .where(eq(tickets.id, id))
      .returning();
    const after = rows[0];
    if (!after) return undefined;

    await this.auditWriter.append({
      action: 'ticket.status_changed',
      resourceType: 'ticket',
      resourceId: id,
      beforeState: { status: before.status },
      afterState: { status: after.status },
      forceEmit: true,
    });
    return after;
  }
}

function ticketSnapshot(t: Ticket): Record<string, unknown> {
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    assigneeId: t.assigneeId,
    organizationId: t.organizationId,
    isPublic: t.isPublic,
  };
}
