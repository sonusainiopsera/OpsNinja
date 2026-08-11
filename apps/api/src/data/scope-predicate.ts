/**
 * scope-predicate — parameterised Drizzle SQL conditions for org-scope filtering.
 *
 * Rules:
 *   - Admin / Lead Analyst: tenant-wide access — no org filter needed.
 *   - Portal principal:     restrict to boundOrganizationId (single org).
 *   - Agent / other staff with scopes: restrict to orgScopeIds.
 *     - Empty scope set  → always-false SQL (sql`false`) — never return unfiltered data.
 *     - 1–threshold IDs  → inArray() parameterised list.
 *     - > threshold IDs  → EXISTS subquery against agent_org_scopes.
 *
 * IMPORTANT: Never use string concatenation of identifiers. All predicates are
 * fully parameterised Drizzle expressions.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SQL, Column } from 'drizzle-orm';

import { agentOrgScopes } from '@opsninja/db';
import type { PrincipalContext } from '../observability/request-context';

/** Roles that are not org-scoped — they see all organizations in the tenant. */
const TENANT_WIDE_ROLES = new Set(['admin', 'lead_analyst']);

/** Above this count use an EXISTS subquery instead of IN to avoid huge literals. */
const LARGE_SCOPE_THRESHOLD = parseInt(process.env['ORG_SCOPE_LARGE_THRESHOLD'] ?? '50', 10);

/**
 * Builds a Drizzle SQL predicate restricting `orgColumn` to the principal's
 * allowed organizations.
 *
 * Returns null when no filter is needed (tenant-wide roles).
 * Returns sql`false` when scope is empty (no orgs assigned).
 *
 * @param principal  The authenticated principal from requestContextStore.
 * @param orgColumn  The organization_id column on the table being queried.
 */
export function buildOrgScopePredicate(
  principal: PrincipalContext,
  orgColumn: Column,
): SQL | null {
  // ── Portal principal: restricted to their single bound organization ────────
  if (principal.principalKind === 'portal') {
    const boundOrgId = principal.boundOrganizationId;
    if (!boundOrgId) {
      // Portal principal without a bound org — deny all (safety net).
      return sql`false`;
    }
    return eq(orgColumn, boundOrgId);
  }

  // ── Tenant-wide roles: no filter ──────────────────────────────────────────
  const hasTenantWideRole = principal.roles.some((r) => TENANT_WIDE_ROLES.has(r));
  if (hasTenantWideRole) {
    return null;
  }

  // ── Machine principals: no org filter (tenant-level access via RLS) ───────
  if (principal.principalKind === 'machine') {
    return null;
  }

  const { orgScopeIds } = principal;

  // ── Empty scope set: explicitly false — never return unfiltered data ───────
  if (orgScopeIds.length === 0) {
    return sql`false`;
  }

  // ── Large scope set: EXISTS subquery ──────────────────────────────────────
  if (orgScopeIds.length > LARGE_SCOPE_THRESHOLD) {
    return and(
      sql`EXISTS (
        SELECT 1 FROM agent_org_scopes aos
        WHERE aos.tenant_id = ${principal.tenantId}::uuid
          AND aos.user_id = ${principal.userId}::uuid
          AND aos.organization_id = ${orgColumn}
      )`,
    ) as SQL;
  }

  // ── Normal scope set: parameterised IN list ────────────────────────────────
  return inArray(orgColumn, orgScopeIds);
}

/**
 * Combines an existing WHERE predicate with the org scope predicate.
 * Convenience wrapper for use in repository findById-style queries.
 *
 * @returns Combined SQL expression, or the original clause when no scope
 *          filter is required (tenant-wide role / machine).
 */
export function withOrgScope(
  existing: SQL | undefined,
  principal: PrincipalContext,
  orgColumn: Column,
): SQL | undefined {
  const scopePredicate = buildOrgScopePredicate(principal, orgColumn);
  if (scopePredicate === null) return existing;
  if (!existing) return scopePredicate;
  return and(existing, scopePredicate) as SQL;
}
