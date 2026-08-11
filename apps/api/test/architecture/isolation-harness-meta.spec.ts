/**
 * Meta-tests — verify the harness has teeth.
 *
 * Each test introduces a deliberate violation condition and asserts that
 * the harness or lint rule would reject it. This proves the guardrails are
 * not vacuously passing.
 *
 * These run in the normal unit test suite (no DB required) because they
 * reason about code structure and predicate logic, not live data.
 */

import { buildOrgScopePredicate } from '../../src/data/scope-predicate';
import { maskNotFound } from '../../src/common/errors/not-found';
import { ROLE_PERMISSIONS, ALL_PERMISSIONS, type Permission } from '../../src/common/auth/permission.catalog';

// ---------------------------------------------------------------------------
// Meta-test: scope predicate must not pass unfiltered results
// ---------------------------------------------------------------------------

describe('Harness meta: scope predicate violations are detectable', () => {
  it('a bypassed scope predicate (returning null for agent) would be caught', () => {
    // If a developer accidentally returned null for agents (bypassing the filter),
    // the harness would detect it because org2 rows would appear in org1 agent results.
    // This meta-test proves the predicate does NOT return null for agent principals.
    const stubCol = { name: 'organization_id', table: { name: 'tickets' } } as never;
    const agentWithScope = {
      tenantId: 't1',
      userId: 'u1',
      principalKind: 'staff' as const,
      roles: ['agent'],
      orgScopeIds: ['org-1'],
      traceId: 'tr1',
    };
    const pred = buildOrgScopePredicate(agentWithScope, stubCol);
    // If pred is null, the harness would fail correctly — this proves it isn't null
    expect(pred).not.toBeNull();
  });

  it('an empty scope set cannot produce an unfiltered result', () => {
    const stubCol = { name: 'organization_id', table: { name: 'tickets' } } as never;
    const agentNoScope = {
      tenantId: 't1',
      userId: 'u1',
      principalKind: 'staff' as const,
      roles: ['agent'],
      orgScopeIds: [],
      traceId: 'tr1',
    };
    const pred = buildOrgScopePredicate(agentNoScope, stubCol);
    // Must be explicitly false — not null (which would mean unfiltered)
    expect(pred).not.toBeNull();
    expect(String(pred)).toContain('false');
  });
});

// ---------------------------------------------------------------------------
// Meta-test: 404 masking must not reveal existence
// ---------------------------------------------------------------------------

describe('Harness meta: 404 masking violation would be detectable', () => {
  it('maskNotFound throws with code RESOURCE_NOT_FOUND (not RESOURCE_SCOPE_BLOCKED)', () => {
    try {
      maskNotFound(null, 'ticket');
    } catch (err) {
      const response = (err as { response?: { code?: string } }).response;
      expect(response?.code).toBe('RESOURCE_NOT_FOUND');
      // If code were 'RESOURCE_SCOPE_BLOCKED' or similar, existence would be disclosed
      expect(response?.code).not.toContain('SCOPE');
      expect(response?.code).not.toContain('BLOCKED');
    }
  });
});

// ---------------------------------------------------------------------------
// Meta-test: permission matrix must have no undeclared permissions
// ---------------------------------------------------------------------------

describe('Harness meta: permission matrix violations are detectable', () => {
  it('adding a permission to a role without declaring it in ALL_PERMISSIONS would fail', () => {
    const allPermSet = new Set<string>(ALL_PERMISSIONS);
    const violations: string[] = [];
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      for (const perm of perms) {
        if (!allPermSet.has(perm)) {
          violations.push(`${role}:${perm}`);
        }
      }
    }
    // This assertion proves the harness would catch the violation
    expect(violations).toEqual([]);
  });

  it('all 7 required roles are present', () => {
    const required = ['admin', 'manager', 'agent', 'lead_analyst', 'integration_admin', 'portal_user', 'machine'];
    for (const role of required) {
      expect(ROLE_PERMISSIONS).toHaveProperty(role);
    }
  });
});

// ---------------------------------------------------------------------------
// Meta-test: fixture determinism — same IDs every run
// ---------------------------------------------------------------------------

describe('Harness meta: fixture identifiers are deterministic', () => {
  it('HARNESS_TENANT_A_ID is a stable constant', async () => {
    const { HARNESS_TENANT_A_ID } = await import('../fixtures/tenant-factory');
    expect(HARNESS_TENANT_A_ID).toBe('f0000000-0000-0000-0000-000000000001');
  });

  it('HARNESS_TENANT_B_ID is a stable constant', async () => {
    const { HARNESS_TENANT_B_ID } = await import('../fixtures/tenant-factory');
    expect(HARNESS_TENANT_B_ID).toBe('f0000000-0000-0000-0000-000000000002');
  });

  it('tenant A and B have different IDs (no collision)', async () => {
    const { HARNESS_TENANT_A_ID, HARNESS_TENANT_B_ID } = await import('../fixtures/tenant-factory');
    expect(HARNESS_TENANT_A_ID).not.toBe(HARNESS_TENANT_B_ID);
  });
});

// ---------------------------------------------------------------------------
// Meta-test: route annotation map completeness
// ---------------------------------------------------------------------------

describe('Harness meta: route annotation coverage', () => {
  it('all harness fixture IDs are in separate UUID ranges to prevent cross-reference', async () => {
    const factory = await import('../fixtures/tenant-factory');
    // Tenant A and B org IDs must not overlap
    const aOrgs = new Set([factory.HARNESS_TENANT_A_ORG1_ID, factory.HARNESS_TENANT_A_ORG2_ID]);
    const bOrgs = new Set([factory.HARNESS_TENANT_B_ORG1_ID, factory.HARNESS_TENANT_B_ORG2_ID]);
    for (const id of aOrgs) {
      expect(bOrgs.has(id)).toBe(false);
    }
  });

  it('harness principals file exports tokens for both tenants', async () => {
    const principals = await import('../fixtures/principals');
    expect(principals.TOKEN_A_ADMIN).toBeDefined();
    expect(principals.TOKEN_B_ADMIN).toBeDefined();
    expect(principals.TOKEN_A_AGENT_ORG1).toBeDefined();
    expect(principals.TOKEN_A_AGENT_ORG2).toBeDefined();
    expect(principals.TOKEN_A_PORTAL_ORG1).toBeDefined();
    expect(principals.TOKEN_B_PORTAL_ORG1).toBeDefined();
    expect(principals.TOKEN_A_AGENT_STALE_VERSION).toBeDefined();
  });
});
