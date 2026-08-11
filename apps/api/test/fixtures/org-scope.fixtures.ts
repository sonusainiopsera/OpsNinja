/**
 * Org-scope fixture set for WO-013 tests.
 *
 * Two tenants, three organisations in Tenant A, two agents with partially
 * overlapping scopes, so the full org-scope read/write matrix is exercisable:
 *
 *   ORG_A1 ←── Agent Alpha (scoped to A1, A2)
 *   ORG_A2 ←── Agent Alpha + Agent Beta
 *   ORG_A3 ←── Agent Beta only
 *
 * Alpha and Beta have overlapping scope on ORG_A2 so we can test:
 *   - Alpha can access ORG_A1 and ORG_A2 tickets (not ORG_A3)
 *   - Beta can access ORG_A2 and ORG_A3 tickets (not ORG_A1)
 *   - Manager can access all three orgs (tenant-wide)
 *
 * All identifiers are deterministic UUIDs derived from readable seeds.
 */

import {
  TENANT_A_ID,
  TENANT_B_ID,
  ORG_A1_ID,
  ORG_A2_ID,
  MANAGER_A_ID,
} from './tenant-factory';

// ── Third org in Tenant A ──────────────────────────────────────────────────────

/** ORG_A3 – belongs to Tenant A, outside Alpha's scope, inside Beta's. */
export const ORG_A3_ID = '00000000-0000-0000-aaaa-000000000003';

// ── Agent IDs ──────────────────────────────────────────────────────────────────

/** Agent Alpha – scoped to ORG_A1 and ORG_A2 (not ORG_A3). */
export const AGENT_ALPHA_ID = '00000000-0000-0002-aaaa-000000000001';
/** Agent Beta  – scoped to ORG_A2 and ORG_A3 (not ORG_A1). */
export const AGENT_BETA_ID  = '00000000-0000-0002-aaaa-000000000002';

// ── Scope rows ─────────────────────────────────────────────────────────────────

export interface ScopeRow {
  tenantId: string;
  userId: string;
  organizationId: string;
  accessLevel: 'full' | 'read_only';
}

export const ALPHA_SCOPE_ROWS: ScopeRow[] = [
  { tenantId: TENANT_A_ID, userId: AGENT_ALPHA_ID, organizationId: ORG_A1_ID, accessLevel: 'full' },
  { tenantId: TENANT_A_ID, userId: AGENT_ALPHA_ID, organizationId: ORG_A2_ID, accessLevel: 'full' },
];

export const BETA_SCOPE_ROWS: ScopeRow[] = [
  { tenantId: TENANT_A_ID, userId: AGENT_BETA_ID,  organizationId: ORG_A2_ID, accessLevel: 'full' },
  { tenantId: TENANT_A_ID, userId: AGENT_BETA_ID,  organizationId: ORG_A3_ID, accessLevel: 'read_only' },
];

export const ALL_SCOPE_ROWS: ScopeRow[] = [
  ...ALPHA_SCOPE_ROWS,
  ...BETA_SCOPE_ROWS,
];

// ── Convenience: derived ID sets ───────────────────────────────────────────────

/** Alpha's org IDs — used to mint test tokens with org_scope_ids. */
export const ALPHA_ORG_IDS = [ORG_A1_ID, ORG_A2_ID];

/** Beta's org IDs. */
export const BETA_ORG_IDS = [ORG_A2_ID, ORG_A3_ID];

/** Org ID that exists in Tenant B — must be rejected if sent to Tenant A scope endpoint. */
export const CROSS_TENANT_ORG_ID = '00000000-0000-0000-bbbb-000000000001'; // ORG_B1 from tenant-factory

// ── Principal snapshots ────────────────────────────────────────────────────────

/**
 * Minimal principal context objects for offline unit tests.
 * These mirror the shape of PrincipalContext without requiring a live DB.
 */

export const MANAGER_PRINCIPAL = {
  tenantId: TENANT_A_ID,
  userId: MANAGER_A_ID,
  principalKind: 'staff' as const,
  roles: ['manager'],
  orgScopeIds: [] as string[],
  orgScopeVersion: 0,
  permissions: new Set(['organizations:manage_scopes', 'tickets:read', 'tickets:write']),
  traceId: 'test-trace-manager',
};

export const ALPHA_PRINCIPAL = {
  tenantId: TENANT_A_ID,
  userId: AGENT_ALPHA_ID,
  principalKind: 'staff' as const,
  roles: ['agent'],
  orgScopeIds: ALPHA_ORG_IDS,
  orgScopeVersion: 1,
  permissions: new Set(['tickets:read', 'tickets:write']),
  traceId: 'test-trace-alpha',
};

export const BETA_PRINCIPAL = {
  tenantId: TENANT_A_ID,
  userId: AGENT_BETA_ID,
  principalKind: 'staff' as const,
  roles: ['agent'],
  orgScopeIds: BETA_ORG_IDS,
  orgScopeVersion: 1,
  permissions: new Set(['tickets:read', 'tickets:write']),
  traceId: 'test-trace-beta',
};

export const EMPTY_SCOPE_PRINCIPAL = {
  tenantId: TENANT_A_ID,
  userId: '00000000-0000-0002-aaaa-000000000099',
  principalKind: 'staff' as const,
  roles: ['agent'],
  orgScopeIds: [] as string[],
  orgScopeVersion: 0,
  permissions: new Set(['tickets:read']),
  traceId: 'test-trace-empty',
};

// ── Ticket fixture references ──────────────────────────────────────────────────

/** Ticket IDs for scope matrix tests. */
export const TICKET_ORG_A1_ID = '00000000-0000-0003-aaaa-000000000001';
export const TICKET_ORG_A2_ID = '00000000-0000-0003-aaaa-000000000002';
export const TICKET_ORG_A3_ID = '00000000-0000-0003-aaaa-000000000003';

export const ORG_SCOPE_MATRIX = {
  tenantId: TENANT_A_ID,
  tenantBId: TENANT_B_ID,
  orgs: {
    a1: ORG_A1_ID,
    a2: ORG_A2_ID,
    a3: ORG_A3_ID,
    crossTenant: CROSS_TENANT_ORG_ID,
  },
  agents: {
    alpha: {
      id: AGENT_ALPHA_ID,
      scopeIds: ALPHA_ORG_IDS,
      canAccess: [ORG_A1_ID, ORG_A2_ID],
      cannotAccess: [ORG_A3_ID],
    },
    beta: {
      id: AGENT_BETA_ID,
      scopeIds: BETA_ORG_IDS,
      canAccess: [ORG_A2_ID, ORG_A3_ID],
      cannotAccess: [ORG_A1_ID],
    },
  },
  manager: {
    id: MANAGER_A_ID,
    tenantWide: true,
    canAccess: [ORG_A1_ID, ORG_A2_ID, ORG_A3_ID],
  },
};
