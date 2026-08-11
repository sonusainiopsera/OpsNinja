/**
 * Test factories for PrincipalContext.
 *
 * Builds authenticated request contexts for staff and portal principals across
 * both seeded tenants.  These factories are the canonical source of test
 * fixtures for all stories that depend on tenant context.
 *
 * Usage:
 * ```typescript
 * const staffPrincipal  = PrincipalFactory.staff({ tenantId: TENANT_A_ID });
 * const portalPrincipal = PrincipalFactory.portal({ tenantId: TENANT_B_ID, orgScopeIds: [ORG_ID] });
 * ```
 */

import { PrincipalContext, PrincipalKind } from '../../src/observability/request-context';

// ── Well-known seeded test tenant / org / user IDs ────────────────────────────

/** Tenant A – used by the first seeded tenant in e2e tests. */
export const TENANT_A_ID = '00000000-0000-0000-0000-000000000001';
/** Tenant B – used by the second seeded tenant in e2e tests. */
export const TENANT_B_ID = '00000000-0000-0000-0000-000000000002';

export const STAFF_USER_A_ID = '00000000-0000-0000-1111-000000000001';
export const STAFF_USER_B_ID = '00000000-0000-0000-1111-000000000002';
export const PORTAL_USER_A_ID = '00000000-0000-0000-2222-000000000001';
export const PORTAL_USER_B_ID = '00000000-0000-0000-2222-000000000002';

export const ORG_A_ID = '00000000-0000-0000-3333-000000000001';
export const ORG_B_ID = '00000000-0000-0000-3333-000000000002';

// ── Factory ───────────────────────────────────────────────────────────────────

type OverrideOptions = Partial<PrincipalContext>;

export class PrincipalFactory {
  /** Creates a staff principal (full access, no org scope restriction). */
  static staff(overrides?: OverrideOptions): PrincipalContext {
    return {
      tenantId: TENANT_A_ID,
      userId: STAFF_USER_A_ID,
      principalKind: 'staff' as PrincipalKind,
      roles: ['agent'],
      orgScopeIds: [],
      traceId: `trace-staff-${Date.now()}`,
      ...overrides,
    };
  }

  /** Creates a portal principal (restricted to visible orgs). */
  static portal(overrides?: OverrideOptions): PrincipalContext {
    return {
      tenantId: TENANT_A_ID,
      userId: PORTAL_USER_A_ID,
      principalKind: 'portal' as PrincipalKind,
      roles: ['portal_user'],
      orgScopeIds: [ORG_A_ID],
      traceId: `trace-portal-${Date.now()}`,
      ...overrides,
    };
  }

  /** Creates a machine principal (worker / webhook receiver). */
  static machine(overrides?: OverrideOptions): PrincipalContext {
    return {
      tenantId: TENANT_A_ID,
      userId: '00000000-0000-0000-9999-000000000001',
      principalKind: 'machine' as PrincipalKind,
      roles: ['worker'],
      orgScopeIds: [],
      traceId: `trace-machine-${Date.now()}`,
      ...overrides,
    };
  }

  /**
   * Serialises a principal as a JSON string suitable for the
   * x-test-principal HTTP header used by the stub auth guard.
   */
  static toHeader(principal: PrincipalContext): string {
    return JSON.stringify(principal);
  }
}
