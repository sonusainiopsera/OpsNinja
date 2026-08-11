/**
 * ScopedQueryHelper — builds non-bypassable Drizzle SQL predicates for
 * portal-principal visibility enforcement.
 *
 * The portal visibility predicate (org + public visibility) is a hard-coded,
 * non-optional constraint. No caller parameter can disable it — the only way
 * to skip it is to not call this helper, which the architecture test detects.
 *
 * Design: pure functions returning Drizzle SQL — no DB access, easily testable.
 */

import { and, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { ticketComments, tickets, ticketAttachments } from '@opsninja/db';
import type { PortalPrincipal } from '../../modules/identity/portal/portal-principal';

/**
 * Ticket list/detail predicate for a portal principal.
 * Restricts results to the portal user's bound organisation only.
 */
export function portalTicketPredicate(portal: PortalPrincipal): SQL {
  return eq(tickets.organizationId, portal.boundOrganizationId);
}

/**
 * Comment list/detail predicate for a portal principal.
 * Restricts results to:
 *   - The portal user's bound organisation (organisation_id = boundOrganizationId)
 *   - Public-visibility comments only (visibility = 'public')
 *
 * Both conditions are mandatory and cannot be individually disabled.
 */
export function portalCommentPredicate(portal: PortalPrincipal): SQL {
  return and(
    eq(ticketComments.organizationId, portal.boundOrganizationId),
    eq(ticketComments.visibility, 'public'),
  ) as SQL;
}

/**
 * Attachment predicate for a portal principal.
 * An attachment is visible when it belongs to the portal user's organisation.
 * Visibility of the parent comment is checked separately in AttachmentAccessService
 * before minting any pre-signed URL.
 */
export function portalAttachmentPredicate(portal: PortalPrincipal): SQL {
  return eq(ticketAttachments.organizationId, portal.boundOrganizationId);
}
