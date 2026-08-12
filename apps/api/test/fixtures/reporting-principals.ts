/**
 * Principal and report-definition fixtures for WO-074 (AC11).
 *
 * Three principals with differing roles and organisation scopes, plus a set
 * of seeded report definitions across all three sharing scopes. These fixtures
 * are consumed by the integration test suite.
 */

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export const REPORT_TENANT_A = 'a1000000-0000-0000-0000-000000000001';
export const REPORT_TENANT_B = 'b1000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Organisations (disjoint between Agent A and Agent B)
// ---------------------------------------------------------------------------

export const ORG_A1 = 'a1000001-0000-0000-0000-000000000001';
export const ORG_A2 = 'a1000002-0000-0000-0000-000000000001';
export const ORG_B1 = 'b1000001-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Principals
// ---------------------------------------------------------------------------

/** Lead — can create, update, delete and run reports; org scope: ORG_A1 + ORG_A2 */
export const PRINCIPAL_LEAD = {
  tenantId:      REPORT_TENANT_A,
  userId:        'u1000001-0000-0000-0000-000000000001',
  principalKind: 'staff' as const,
  roles:         ['lead'],
  orgScopeIds:   [ORG_A1, ORG_A2],
  traceId:       'trace-lead-001',
};

/** Agent A — can read shared reports; org scope: ORG_A1 only */
export const PRINCIPAL_AGENT_A = {
  tenantId:      REPORT_TENANT_A,
  userId:        'u1000002-0000-0000-0000-000000000001',
  principalKind: 'staff' as const,
  roles:         ['agent'],
  orgScopeIds:   [ORG_A1],
  traceId:       'trace-agent-a-001',
};

/** Agent B — disjoint org scope from Agent A; org scope: ORG_A2 only */
export const PRINCIPAL_AGENT_B = {
  tenantId:      REPORT_TENANT_A,
  userId:        'u1000003-0000-0000-0000-000000000001',
  principalKind: 'staff' as const,
  roles:         ['agent'],
  orgScopeIds:   [ORG_A2],
  traceId:       'trace-agent-b-001',
};

/** Manager — cross-tenant: belongs to TENANT_B (used for cross-tenant 404 assertions) */
export const PRINCIPAL_TENANT_B_LEAD = {
  tenantId:      REPORT_TENANT_B,
  userId:        'u2000001-0000-0000-0000-000000000001',
  principalKind: 'staff' as const,
  roles:         ['lead'],
  orgScopeIds:   [ORG_B1],
  traceId:       'trace-tenant-b-lead-001',
};

// ---------------------------------------------------------------------------
// Report definition fixtures (not persisted — used as DTOs in tests)
// ---------------------------------------------------------------------------

/** A private definition owned by PRINCIPAL_LEAD */
export const FIXTURE_DEFINITION_PRIVATE = {
  name:         'Lead-Private Weekly SLA',
  description:  'Visible only to the creating Lead',
  metrics:      ['ticket_count'],
  groupBy:      ['priority'],
  chartType:    'bar' as const,
  sharingScope: 'private' as const,
};

/** A team-scoped definition visible to all principals in the tenant */
export const FIXTURE_DEFINITION_TEAM = {
  name:         'Team Throughput Dashboard',
  description:  'Shared with the whole team',
  metrics:      ['ticket_count'],
  groupBy:      ['status'],
  chartType:    'table' as const,
  sharingScope: 'team' as const,
};

/** A tenant-wide definition: visible to all; used for disjoint-scope divergence test */
export const FIXTURE_DEFINITION_TENANT = {
  name:         'Tenant-Wide Priority Breakdown',
  description:  'Used to test viewer-scope re-evaluation with disjoint org scopes',
  metrics:      ['ticket_count'],
  groupBy:      ['priority'],
  chartType:    'bar' as const,
  sharingScope: 'tenant' as const,
};
