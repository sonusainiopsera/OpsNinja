import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { tickets, type Ticket, type NewTicket } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { getPrincipalContext } from '../../../observability/request-context';
import { isPortalPrincipal } from '../../identity/portal/portal-principal';
import { portalTicketPredicate } from '../../../common/db/scoped-query.helper';
import { buildOrgScopePredicate, withOrgScope } from '../../../data/scope-predicate';
import { OrganizationsService } from '../../organizations/organizations.service';

@Injectable()
export class TicketRepository extends TenantRepository {
  constructor(private readonly orgsService: OrganizationsService) {
    super();
  }

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

  /**
   * Guard called before creating a new ticket.
   *
   * Calls OrganizationsService.isOrganizationActive() rather than joining
   * directly to the organizations table — this enforces the module boundary
   * rule so the tickets module never reads org data directly.
   *
   * Throws 422 ORGANIZATION_INACTIVE when the org is inactive or unknown.
   */
  async assertOrganizationActive(tenantId: string, organizationId: string): Promise<void> {
    const active = await this.orgsService.isOrganizationActive(tenantId, organizationId);
    if (!active) {
      throw new UnprocessableEntityException({
        error: {
          code: 'ORGANIZATION_INACTIVE',
          message: 'Cannot create a ticket for an inactive organization.',
          details: [{ organizationId }],
        },
      });
    }
  }
}
