/**
 * Fixtures for org-scope unit and integration tests.
 *
 * Scenario: one tenant, three organizations (A, B, C), two agents with
 * partially overlapping scopes, and one manager with tenant-wide access.
 *
 *   Agent 1 (agentA):  scoped to org-A and org-B
 *   Agent 2 (agentB):  scoped to org-B and org-C
 *   Manager:           no org scope rows (tenant-wide by role)
 *
 * Overlapping org-B tests cross-org and shared-scope behaviour.
 * Non-overlapping org-A (agentA only) and org-C (agentB only) test isolation.
 */

export const ORG_SCOPE_TENANT_ID = 'f1000000-0000-0000-0000-000000000001';

export const ORG_SCOPE_ORG_A_ID = 'f1000001-0000-0000-0000-000000000001';
export const ORG_SCOPE_ORG_B_ID = 'f1000001-0000-0000-0000-000000000002';
export const ORG_SCOPE_ORG_C_ID = 'f1000001-0000-0000-0000-000000000003';

export const ORG_SCOPE_AGENT_A_ID = 'f1000002-0000-0000-0000-000000000001';
export const ORG_SCOPE_AGENT_B_ID = 'f1000002-0000-0000-0000-000000000002';
export const ORG_SCOPE_MANAGER_ID = 'f1000002-0000-0000-0000-000000000003';

// Tickets — one per org
export const ORG_SCOPE_TICKET_ORG_A_ID = 'f1000010-0000-0000-0000-000000000001';
export const ORG_SCOPE_TICKET_ORG_B_ID = 'f1000010-0000-0000-0000-000000000002';
export const ORG_SCOPE_TICKET_ORG_C_ID = 'f1000010-0000-0000-0000-000000000003';

// Initial scope assignments
export const INITIAL_AGENT_A_SCOPES = [ORG_SCOPE_ORG_A_ID, ORG_SCOPE_ORG_B_ID];
export const INITIAL_AGENT_B_SCOPES = [ORG_SCOPE_ORG_B_ID, ORG_SCOPE_ORG_C_ID];

// Scope matrix for test assertions:
//   true  = agent should be able to read this ticket (200 on GET by id)
//   false = agent should get 404 for this ticket (org out of scope)
export const SCOPE_MATRIX: Record<string, Record<string, boolean>> = {
  [ORG_SCOPE_AGENT_A_ID]: {
    [ORG_SCOPE_TICKET_ORG_A_ID]: true,   // org-A in scope
    [ORG_SCOPE_TICKET_ORG_B_ID]: true,   // org-B in scope
    [ORG_SCOPE_TICKET_ORG_C_ID]: false,  // org-C NOT in scope
  },
  [ORG_SCOPE_AGENT_B_ID]: {
    [ORG_SCOPE_TICKET_ORG_A_ID]: false,  // org-A NOT in scope
    [ORG_SCOPE_TICKET_ORG_B_ID]: true,   // org-B in scope
    [ORG_SCOPE_TICKET_ORG_C_ID]: true,   // org-C in scope
  },
};

// PrincipalContext stubs for unit tests
export function makeAgentAPrincipal(orgScopeVersion = 1) {
  return {
    tenantId: ORG_SCOPE_TENANT_ID,
    userId: ORG_SCOPE_AGENT_A_ID,
    principalKind: 'staff' as const,
    roles: ['agent'],
    orgScopeIds: INITIAL_AGENT_A_SCOPES,
    traceId: 'trace-agent-a',
    orgScopeVersion,
  };
}

export function makeAgentBPrincipal(orgScopeVersion = 1) {
  return {
    tenantId: ORG_SCOPE_TENANT_ID,
    userId: ORG_SCOPE_AGENT_B_ID,
    principalKind: 'staff' as const,
    roles: ['agent'],
    orgScopeIds: INITIAL_AGENT_B_SCOPES,
    traceId: 'trace-agent-b',
    orgScopeVersion,
  };
}

export function makeManagerPrincipal() {
  return {
    tenantId: ORG_SCOPE_TENANT_ID,
    userId: ORG_SCOPE_MANAGER_ID,
    principalKind: 'staff' as const,
    roles: ['manager'],
    // managers are tenant-wide but may still be subject to scope predicate
    // unless they have an explicit tenant-wide role (admin/lead_analyst)
    orgScopeIds: [],
    traceId: 'trace-manager',
  };
}

export function makeAdminPrincipal() {
  return {
    tenantId: ORG_SCOPE_TENANT_ID,
    userId: ORG_SCOPE_MANAGER_ID,
    principalKind: 'staff' as const,
    roles: ['admin'],
    orgScopeIds: [],
    traceId: 'trace-admin',
  };
}
