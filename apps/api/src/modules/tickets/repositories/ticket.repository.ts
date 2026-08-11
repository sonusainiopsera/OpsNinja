import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { tickets, type Ticket } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { getPrincipalContext } from '../../../observability/request-context';
import { isPortalPrincipal } from '../../identity/portal/portal-principal';
import { portalTicketPredicate } from '../../../common/db/scoped-query.helper';
import { buildOrgScopePredicate, withOrgScope } from '../../../data/scope-predicate';

@Injectable()
export class TicketRepository extends TenantRepository {
  async findAll(): Promise<Ticket[]> {
    const principal = getPrincipalContext();
    if (isPortalPrincipal(principal)) {
      return this.tx
        .select()
        .from(tickets)
        .where(portalTicketPredicate(principal));
    }
    const scopePredicate = buildOrgScopePredicate(principal, tickets.organizationId);
    if (scopePredicate === null) {
      return this.tx.select().from(tickets);
    }
    return this.tx.select().from(tickets).where(scopePredicate);
  }

  async findById(id: string): Promise<Ticket | null> {
    const principal = getPrincipalContext();
    const baseWhere = eq(tickets.id, id);
    let where;
    if (isPortalPrincipal(principal)) {
      where = and(baseWhere, portalTicketPredicate(principal));
    } else {
      where = withOrgScope(baseWhere, principal, tickets.organizationId);
    }

    const rows = await this.tx.select().from(tickets).where(where).limit(1);
    return rows[0] ?? null;
  }
}
