/**
 * Unit tests for WO-043 suite helper utilities — AC8.
 *
 * Tests:
 *  1. Principal factory functions produce correct shape and values
 *  2. buildOrgAccessMatrix generates the expected matrix entries
 *  3. principalHasOrgAccess returns correct results for all principal types
 *  4. TICKETS_MODULE_TABLES manifest is non-empty and contains core tables
 *  5. EXPECTED_OUTBOX_EVENTS multiset contains the required lifecycle events
 *  6. Shared-seed SHARED_IDS are all valid-format UUIDs
 *
 * These run without a database — pure unit assertions.
 */

import {
  makeAdminPrincipal,
  makeAgentPrincipal,
  makePortalPrincipal,
  makeCrossTenantPrincipal,
  buildOrgAccessMatrix,
  principalHasOrgAccess,
  SUPPORT_TENANT_A,
  SUPPORT_TENANT_B,
  SUPPORT_ORG_1,
  SUPPORT_ORG_2,
} from '../support/principals';

import { TICKETS_MODULE_TABLES } from '../isolation/table-matrix.spec';
import { EXPECTED_OUTBOX_EVENTS } from '../e2e/ticket-lifecycle.spec';
import { SHARED_IDS } from '../../../../packages/db/test/fixtures/shared-seed';

// ---------------------------------------------------------------------------
// UUID format validator (simple RFC-4122 pattern)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
}

// ---------------------------------------------------------------------------
// 1. Principal factory shapes
// ---------------------------------------------------------------------------

describe('Principal factory: makeAdminPrincipal', () => {
  it('returns a staff admin with empty orgScopeIds', () => {
    const p = makeAdminPrincipal();
    expect(p.roles).toContain('admin');
    expect(p.principalKind).toBe('staff');
    expect(p.orgScopeIds).toEqual([]);
    expect(p.tenantId).toBe(SUPPORT_TENANT_A);
  });

  it('accepts overrides', () => {
    const p = makeAdminPrincipal({ tenantId: SUPPORT_TENANT_B, orgScopeVersion: 5 });
    expect(p.tenantId).toBe(SUPPORT_TENANT_B);
    expect(p.orgScopeVersion).toBe(5);
  });

  it('traceId is always populated', () => {
    const p = makeAdminPrincipal();
    expect(p.traceId).toBeTruthy();
    expect(typeof p.traceId).toBe('string');
  });
});

describe('Principal factory: makeAgentPrincipal', () => {
  it('includes the supplied org scope IDs', () => {
    const p = makeAgentPrincipal([SUPPORT_ORG_1, SUPPORT_ORG_2]);
    expect(p.orgScopeIds).toEqual([SUPPORT_ORG_1, SUPPORT_ORG_2]);
    expect(p.roles).toContain('agent');
    expect(p.principalKind).toBe('staff');
  });

  it('empty orgScopeIds is allowed (no access)', () => {
    const p = makeAgentPrincipal([]);
    expect(p.orgScopeIds).toHaveLength(0);
  });
});

describe('Principal factory: makePortalPrincipal', () => {
  it('sets principalKind to portal and includes boundOrgId in scope', () => {
    const p = makePortalPrincipal(SUPPORT_ORG_1);
    expect(p.principalKind).toBe('portal');
    expect(p.orgScopeIds).toContain(SUPPORT_ORG_1);
    expect(p.roles).toContain('portal_user');
  });
});

describe('Principal factory: makeCrossTenantPrincipal', () => {
  it('uses TENANT_B as tenantId by default', () => {
    const p = makeCrossTenantPrincipal();
    expect(p.tenantId).toBe(SUPPORT_TENANT_B);
  });

  it('is admin role but in wrong tenant', () => {
    const p = makeCrossTenantPrincipal();
    expect(p.roles).toContain('admin');
    expect(p.tenantId).not.toBe(SUPPORT_TENANT_A);
  });
});

// ---------------------------------------------------------------------------
// 2. buildOrgAccessMatrix
// ---------------------------------------------------------------------------

describe('buildOrgAccessMatrix', () => {
  const matrix = buildOrgAccessMatrix(SUPPORT_ORG_1, SUPPORT_ORG_2);

  it('returns exactly 5 entries', () => {
    expect(matrix).toHaveLength(5);
  });

  it('admin entry has expectedAccess=true', () => {
    const admin = matrix.find((e) => e.label.includes('admin (tenant-wide)'));
    expect(admin?.expectedAccess).toBe(true);
  });

  it('agent scoped to target org has expectedAccess=true', () => {
    const entry = matrix.find((e) => e.label.includes('agent scoped to target org'));
    expect(entry?.expectedAccess).toBe(true);
  });

  it('agent scoped to other org only has expectedAccess=false', () => {
    const entry = matrix.find((e) => e.label.includes('other org only'));
    expect(entry?.expectedAccess).toBe(false);
  });

  it('cross-tenant admin has expectedAccess=false', () => {
    const entry = matrix.find((e) => e.label.includes('cross-tenant'));
    expect(entry?.expectedAccess).toBe(false);
  });

  it('all entries have a label and a principal', () => {
    for (const entry of matrix) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.principal.tenantId).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. principalHasOrgAccess
// ---------------------------------------------------------------------------

describe('principalHasOrgAccess', () => {
  it('admin returns true for any org in same tenant', () => {
    const admin = makeAdminPrincipal({ tenantId: SUPPORT_TENANT_A });
    expect(principalHasOrgAccess(admin, SUPPORT_TENANT_A, SUPPORT_ORG_1)).toBe(true);
    expect(principalHasOrgAccess(admin, SUPPORT_TENANT_A, SUPPORT_ORG_2)).toBe(true);
  });

  it('agent with ORG_1 scope can access ORG_1 but not ORG_2', () => {
    const agent = makeAgentPrincipal([SUPPORT_ORG_1]);
    expect(principalHasOrgAccess(agent, SUPPORT_TENANT_A, SUPPORT_ORG_1)).toBe(true);
    expect(principalHasOrgAccess(agent, SUPPORT_TENANT_A, SUPPORT_ORG_2)).toBe(false);
  });

  it('cross-tenant principal always returns false regardless of role', () => {
    const xtenant = makeCrossTenantPrincipal(); // TENANT_B
    expect(principalHasOrgAccess(xtenant, SUPPORT_TENANT_A, SUPPORT_ORG_1)).toBe(false);
  });

  it('portal user can only access their bound org', () => {
    const portal = makePortalPrincipal(SUPPORT_ORG_1);
    expect(principalHasOrgAccess(portal, SUPPORT_TENANT_A, SUPPORT_ORG_1)).toBe(true);
    expect(principalHasOrgAccess(portal, SUPPORT_TENANT_A, SUPPORT_ORG_2)).toBe(false);
  });

  it('agent with empty scope cannot access any org', () => {
    const agent = makeAgentPrincipal([]);
    expect(principalHasOrgAccess(agent, SUPPORT_TENANT_A, SUPPORT_ORG_1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. TICKETS_MODULE_TABLES manifest
// ---------------------------------------------------------------------------

describe('TICKETS_MODULE_TABLES manifest', () => {
  it('is non-empty', () => {
    expect(TICKETS_MODULE_TABLES.length).toBeGreaterThan(0);
  });

  it('contains the core ticketing tables', () => {
    const core = ['tickets', 'ticket_comments', 'ticket_attachments'];
    for (const table of core) {
      expect(TICKETS_MODULE_TABLES).toContain(table);
    }
  });

  it('contains no duplicates', () => {
    const deduped = new Set(TICKETS_MODULE_TABLES);
    expect(deduped.size).toBe(TICKETS_MODULE_TABLES.length);
  });

  it('all entries are lowercase snake_case strings', () => {
    for (const table of TICKETS_MODULE_TABLES) {
      expect(table).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. EXPECTED_OUTBOX_EVENTS multiset
// ---------------------------------------------------------------------------

describe('EXPECTED_OUTBOX_EVENTS', () => {
  it('contains ticket.created exactly once', () => {
    const count = EXPECTED_OUTBOX_EVENTS.filter((e) => e === 'ticket.created').length;
    expect(count).toBe(1);
  });

  it('contains ticket.resolved exactly once', () => {
    const count = EXPECTED_OUTBOX_EVENTS.filter((e) => e === 'ticket.resolved').length;
    expect(count).toBe(1);
  });

  it('does not contain ticket.sla_breached (not part of basic lifecycle)', () => {
    expect(EXPECTED_OUTBOX_EVENTS).not.toContain('ticket.sla_breached');
  });

  it('all events follow the dot-namespace format', () => {
    for (const event of EXPECTED_OUTBOX_EVENTS) {
      expect(event).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. SHARED_IDS UUID validity
// ---------------------------------------------------------------------------

describe('SHARED_IDS UUID format', () => {
  it('all exported IDs are valid RFC-4122 UUID format', () => {
    for (const [key, value] of Object.entries(SHARED_IDS)) {
      expect(
        isValidUuid(value),
        `SHARED_IDS.${key} = "${value}" is not a valid UUID`,
      ).toBe(true);
    }
  });

  it('TENANT_A and TENANT_B are distinct', () => {
    expect(SHARED_IDS.TENANT_A).not.toBe(SHARED_IDS.TENANT_B);
  });

  it('all IDs are unique (no accidental collisions)', () => {
    const ids = Object.values(SHARED_IDS);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
