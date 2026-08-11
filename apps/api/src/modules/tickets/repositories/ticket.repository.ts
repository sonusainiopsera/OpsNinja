import { Injectable } from '@nestjs/common';
import { eq, and, tickets } from '@opsninja/db';
import type { Ticket } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { portalTicketFilter } from '../../../common/db/scoped-query.helper';
import type { PortalPrincipal } from '../../identity/portal/portal-principal';

@Injectable()
export class TicketRepository extends TenantRepository {
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
}
