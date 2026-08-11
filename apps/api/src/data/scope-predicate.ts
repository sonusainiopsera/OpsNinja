/**
 * Scope predicate helper.
 *
 * Builds a parameterised Drizzle condition that restricts a query to the
 * organization IDs in scope for the current principal.
 *
 * Rules:
 *  - Tenant-wide roles (admin, supervisor, manager, lead …) → no predicate added.
 *  - Portal principals → restrict to their single boundOrganizationId.
 *  - Scoped staff agents → restrict to their org scope set.
 *  - Empty scope set → return an explicitly-false predicate (1 = 0) so the
 *    result is always empty, never unfiltered.
 *  - Large scope sets (> IN_LIST_THRESHOLD) → use EXISTS subquery against
 *    agent_org_scopes to avoid unbounded IN lists.
 *
 * IMPORTANT: Never omit this predicate for scoped agents. An empty IN list is
 * a programming defect and is rejected rather than silently returning all rows.
 */

import type { SQL } from 'drizzle-orm';
import { eq, inArray, sql } from 'drizzle-orm';
import { tickets } from '@opsninja/db';
import { TENANT_WIDE_ROLES } from '../common/auth/permissions';
import type { PrincipalContext } from '../observability/request-context';

/** Switch from IN(…) to EXISTS subquery above this threshold. */
const IN_LIST_THRESHOLD = 50;

/**
 * Returns a Drizzle SQL predicate for `tickets.organizationId` based on the
 * caller's principal context, or `undefined` when no restriction is needed
 * (tenant-wide roles).
 *
 * The returned condition must be passed as an additional AND clause to every
 * list query so scoped agents do not see tickets outside their assigned orgs.
 */
export function buildOrgScopePredicate(
  principal: PrincipalContext,
): SQL<unknown> | undefined {
  // Portal principals: confined to their single bound organization.
  if (principal.principalKind === 'portal') {
    const boundOrgId = principal.orgScopeIds[0];
    if (!boundOrgId) {
      // Portal user with no bound org — deny all (should not happen in practice).
      return sql`1 = 0`;
    }
    return eq(tickets.organizationId, boundOrgId);
  }

  // Staff: check whether any role grants tenant-wide scope.
  const hasTenantWideRole = principal.roles.some((r) => TENANT_WIDE_ROLES.has(r));
  if (hasTenantWideRole) {
    return undefined; // No restriction.
  }

  // Scoped staff agent.
  const scopeIds = principal.orgScopeIds;

  if (scopeIds.length === 0) {
    // Empty scope set → always-false predicate.
    return sql`1 = 0`;
  }

  if (scopeIds.length <= IN_LIST_THRESHOLD) {
    return inArray(tickets.organizationId, scopeIds);
  }

  // Large scope set: use EXISTS subquery against agent_org_scopes to avoid
  // generating a large IN list that Postgres cannot plan efficiently.
  return sql`EXISTS (
    SELECT 1
    FROM agent_org_scopes aos
    WHERE aos.tenant_id = ${principal.tenantId}::uuid
      AND aos.user_id   = ${principal.userId}::uuid
      AND aos.organization_id = ${tickets.organizationId}
  )`;
}

/**
 * Convenience: returns whether this principal has an unrestricted view of
 * all organizations within the tenant (i.e. no org-scope filter needed).
 */
export function isTenantWide(principal: PrincipalContext): boolean {
  if (principal.principalKind !== 'staff') return false;
  return principal.roles.some((r) => TENANT_WIDE_ROLES.has(r));
}
