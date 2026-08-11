/**
 * Scope test fixtures.
 *
 * Provides pre-built agent and portal principal objects and scope row stubs
 * for unit and integration tests covering RBAC org-scope functionality.
 */

import type { PrincipalContext } from '../../src/observability/request-context';
import { mintTestToken, TENANT_A_ID, STAFF_AUDIENCE, PORTAL_AUDIENCE } from './rbac.fixtures';

// ── Well-known IDs ────────────────────────────────────────────────────────────

export const TENANT_ID = TENANT_A_ID;

export const SCOPE_AGENT_ID    = '00000000-0000-0000-bbbb-000000000001';
export const SCOPE_MANAGER_ID  = '00000000-0000-0000-bbbb-000000000002';
export const SCOPE_PORTAL_ID   = '00000000-0000-0000-bbbb-000000000003';

export const ORG_A_ID = '00000000-0000-0000-cccc-000000000001';
export const ORG_B_ID = '00000000-0000-0000-cccc-000000000002';
export const ORG_C_ID = '00000000-0000-0000-cccc-000000000003';

// ── Principal builders ────────────────────────────────────────────────────────

export function makeAgentPrincipal(
  orgScopeIds: string[] = [ORG_A_ID],
  overrides: Partial<PrincipalContext> = {},
): PrincipalContext {
  return {
    tenantId: TENANT_ID,
    userId: SCOPE_AGENT_ID,
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds,
    traceId: 'trace-scope-agent',
    orgScopeVersion: 1,
    ...overrides,
  };
}

export function makeManagerPrincipal(
  overrides: Partial<PrincipalContext> = {},
): PrincipalContext {
  return {
    tenantId: TENANT_ID,
    userId: SCOPE_MANAGER_ID,
    principalKind: 'staff',
    roles: ['manager'],
    orgScopeIds: [],
    traceId: 'trace-scope-manager',
    orgScopeVersion: 0,
    ...overrides,
  };
}

export function makePortalPrincipal(
  boundOrgId: string = ORG_A_ID,
  overrides: Partial<PrincipalContext> = {},
): PrincipalContext {
  return {
    tenantId: TENANT_ID,
    userId: SCOPE_PORTAL_ID,
    principalKind: 'portal',
    roles: ['portal_user'],
    orgScopeIds: [boundOrgId],
    traceId: 'trace-scope-portal',
    ...overrides,
  };
}

// ── Token factories ───────────────────────────────────────────────────────────

/** Agent token with orgScopeVersion=1, scoped to ORG_A_ID. */
export const AGENT_SCOPED_TOKEN = mintTestToken({
  userId: SCOPE_AGENT_ID,
  tenantId: TENANT_ID,
  roles: ['agent'],
  audience: STAFF_AUDIENCE,
});

/** Agent token with a deliberately stale org_scope_version. */
export const STALE_AGENT_TOKEN = mintTestToken({
  userId: SCOPE_AGENT_ID,
  tenantId: TENANT_ID,
  roles: ['agent'],
  audience: STAFF_AUDIENCE,
});

/** Manager token (tenant-wide, no scope restriction). */
export const MANAGER_TOKEN = mintTestToken({
  userId: SCOPE_MANAGER_ID,
  tenantId: TENANT_ID,
  roles: ['manager'],
  audience: STAFF_AUDIENCE,
});

/** Portal token bound to ORG_A_ID. */
export const PORTAL_SCOPED_TOKEN = mintTestToken({
  userId: SCOPE_PORTAL_ID,
  tenantId: TENANT_ID,
  roles: ['portal_user'],
  audience: PORTAL_AUDIENCE,
});

// ── Scope row stubs ───────────────────────────────────────────────────────────

export interface ScopeRow {
  organizationId: string;
  accessLevel: string;
}

export const AGENT_SCOPE_ROWS: ScopeRow[] = [
  { organizationId: ORG_A_ID, accessLevel: 'full' },
  { organizationId: ORG_B_ID, accessLevel: 'read_only' },
];

/** A scope set large enough to trigger the EXISTS subquery branch (>50 orgs). */
export const LARGE_SCOPE_IDS: string[] = Array.from(
  { length: 55 },
  (_, i) => `00000000-0000-0000-cccc-${String(i + 10).padStart(12, '0')}`,
);
