/**
 * Scoped query predicates for portal principals.
 *
 * These are the SINGLE enforcement point for portal data-access restrictions.
 * All portal repository methods must pass these predicates to their queries —
 * there is no parameter or flag that can disable them.
 *
 * portalTicketFilter:  organization_id = :boundOrg
 * portalCommentFilter: comment.visibility = 'public'
 *
 * The comment filter does not check organization scope because comments are always
 * accessed through a ticket that has already been scope-checked.
 */

import type { SQL } from 'drizzle-orm';
import { eq, and } from '@opsninja/db';
import { tickets, comments } from '@opsninja/db';
import type { PortalPrincipal } from '../../modules/identity/portal/portal-principal';

/**
 * Restricts a ticket query to the portal principal's bound organisation.
 *
 * Must be included in every ticket SELECT / JOIN for portal callers.
 */
export function portalTicketFilter(principal: PortalPrincipal): SQL<unknown> {
  return eq(tickets.organizationId, principal.boundOrganizationId);
}

/**
 * Restricts a comment query to public-visibility rows only.
 *
 * Must be included in every comment SELECT for portal callers.
 * The predicate is intentionally non-parameterised so no caller can pass
 * a flag to widen it.
 */
export function portalCommentFilter(): SQL<unknown> {
  return eq(comments.visibility, 'public');
}

/**
 * Combined predicate for comment queries that also need a ticket scope check.
 * Returns visibility = 'public' AND ticket_id = :ticketId.
 */
export function portalCommentForTicketFilter(ticketId: string): SQL<unknown> {
  return and(
    eq(comments.ticketId, ticketId),
    portalCommentFilter(),
  )!;
}
