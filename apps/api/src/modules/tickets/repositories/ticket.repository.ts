/**
 * TicketRepository — data access for the tickets domain.
 *
 * Extends TenantRepository so every query runs inside the tenant-bound
 * Drizzle transaction handle from withTenantTransaction().
 *
 * Org-scope enforcement:
 *   - Portal principal: predicate forces boundOrganizationId + visibility='public'.
 *   - Staff principal: withOrgScope() applies orgScopeIds or admin/lead bypass.
 *   - Unknown/missing scope: returns zero rows (fail-closed).
 *
 * Module boundary: this class NEVER joins to tables owned by other modules.
 * Org/contact validation is done via OrganizationsService (injected).
 */

import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import {
  tickets,
  tags,
  ticketTags,
  contacts,
  organizationsRegistry,
  users,
  type Ticket,
  type NewTicket,
  type Tag,
} from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { getPrincipalContext } from '../../../observability/request-context';
import { isPortalPrincipal } from '../../identity/portal/portal-principal';
import { portalTicketPredicate } from '../../../common/db/scoped-query.helper';
import { buildOrgScopePredicate, withOrgScope } from '../../../data/scope-predicate';
import { OrganizationsService } from '../../organizations/organizations.service';
import type {
  OrganizationSummaryDto,
  RequesterSummaryDto,
  AssigneeSummaryDto,
  TicketEnrichment,
  TagDto,
} from '../dto/ticket-response.dto';

@Injectable()
export class TicketRepository extends TenantRepository {
  constructor(private readonly orgsService: OrganizationsService) {
    super();
  }

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

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

  /**
   * Find a ticket by ID with org-scope enforcement.
   * Returns null for unknown, foreign-tenant, or out-of-scope IDs — never 403.
   */
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

  // --------------------------------------------------------------------------
  // Write
  // --------------------------------------------------------------------------

  /**
   * Insert a new ticket row and return the persisted entity.
   *
   * tag_ids are inserted into ticket_tags in the same call so the write
   * is atomic — caller must have already validated tags exist in this tenant.
   */
  async createTicket(
    payload: Omit<NewTicket, 'id' | 'createdAt' | 'updatedAt'> & { tenantId: string },
    tagIds: string[],
  ): Promise<Ticket> {
    const [row] = await this.tx
      .insert(tickets)
      .values(payload)
      .returning();

    if (!row) throw new Error('Ticket insert returned no rows');

    if (tagIds.length > 0) {
      await this.tx.insert(ticketTags).values(
        tagIds.map((tagId) => ({
          tenantId: payload.tenantId,
          ticketId: row.id,
          tagId,
        })),
      );
    }

    return row;
  }

  // --------------------------------------------------------------------------
  // Enrichment — loads org, requester, assignee and tags for the response DTO.
  // These are intentionally separate queries so callers can skip them when
  // only the raw row is needed (e.g. internal queue aggregations).
  // --------------------------------------------------------------------------

  async loadEnrichment(ticket: Ticket): Promise<TicketEnrichment> {
    const tenantId = ticket.tenantId;

    // Organization summary
    const [orgRow] = await this.tx
      .select({
        id: organizationsRegistry.id,
        name: organizationsRegistry.name,
        slaTier: organizationsRegistry.slaTier,
      })
      .from(organizationsRegistry)
      .where(
        and(
          eq(organizationsRegistry.tenantId, tenantId),
          eq(organizationsRegistry.id, ticket.organizationId),
        ),
      )
      .limit(1);

    const organization: OrganizationSummaryDto = orgRow
      ? { id: orgRow.id, name: orgRow.name, slaTier: orgRow.slaTier ?? null }
      : { id: ticket.organizationId, name: '[unknown]', slaTier: null };

    // Requester contact summary (PII — only included in agent-facing responses)
    let requester: RequesterSummaryDto | null = null;
    if (ticket.requesterContactId) {
      const [contactRow] = await this.tx
        .select({
          id: contacts.id,
          email: contacts.email,
          fullName: contacts.fullName,
        })
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, tenantId),
            eq(contacts.id, ticket.requesterContactId),
          ),
        )
        .limit(1);
      if (contactRow) {
        requester = {
          id: contactRow.id,
          email: contactRow.email,
          fullName: contactRow.fullName,
        };
      }
    }

    // Assignee summary (staff user)
    let assignee: AssigneeSummaryDto | null = null;
    if (ticket.assigneeId) {
      const [userRow] = await this.tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(
          and(
            eq(users.tenantId, tenantId),
            eq(users.id, ticket.assigneeId),
          ),
        )
        .limit(1);
      if (userRow) {
        assignee = { id: userRow.id, name: userRow.email, email: userRow.email };
      }
    }

    // Tags via join table
    let tagDtos: TagDto[] = [];
    const tagLinks = await this.tx
      .select({ tagId: ticketTags.tagId })
      .from(ticketTags)
      .where(
        and(
          eq(ticketTags.tenantId, tenantId),
          eq(ticketTags.ticketId, ticket.id),
        ),
      );

    if (tagLinks.length > 0) {
      const tagIdList = tagLinks.map((t) => t.tagId);
      const tagRows = await this.tx
        .select({ id: tags.id, name: tags.name, color: tags.color })
        .from(tags)
        .where(
          and(
            eq(tags.tenantId, tenantId),
            inArray(tags.id, tagIdList),
          ),
        );
      tagDtos = tagRows.map((r) => ({ id: r.id, name: r.name, color: r.color ?? null }));
    }

    return { organization, requester, assignee, tags: tagDtos };
  }

  // --------------------------------------------------------------------------
  // Validation helpers
  // --------------------------------------------------------------------------

  /**
   * Assert organisation exists and is active before creating a ticket.
   * Calls OrganizationsService — never joins the org table directly.
   * Throws 422 ORGANIZATION_INACTIVE for unknown or deactivated orgs.
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

  /**
   * Validate that all provided tag IDs exist in this tenant.
   * Returns the valid subset; unknown IDs are identified so the caller can 400.
   */
  async filterValidTagIds(tenantId: string, tagIds: string[]): Promise<string[]> {
    if (tagIds.length === 0) return [];
    const rows = await this.tx
      .select({ id: tags.id })
      .from(tags)
      .where(
        and(
          eq(tags.tenantId, tenantId),
          inArray(tags.id, tagIds),
        ),
      );
    return rows.map((r) => r.id);
  }

  /**
   * Verify a contact exists, belongs to the given organisation, and is active.
   * Returns true when valid. Used to enforce requester_contact_id ownership.
   */
  async contactBelongsToOrg(
    tenantId: string,
    contactId: string,
    organizationId: string,
  ): Promise<boolean> {
    const rows = await this.tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.tenantId, tenantId),
          eq(contacts.id, contactId),
          eq(contacts.organizationId, organizationId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
