/**
 * Test factories for PrincipalContext.
 *
 * Committed for reuse by later stories. Every story that writes tests against
 * an authenticated request should import these factories rather than constructing
 * PrincipalContext inline.
 *
 * The factories cover all three principal populations (staff, portal, machine)
 * and both seeded tenants (TENANT_A_ID, TENANT_B_ID) defined in the integration
 * test seed data.
 */

import { randomUUID } from 'crypto';
import { PrincipalContext, PrincipalKind } from '../../src/observability/request-context';

// ---------------------------------------------------------------------------
// Seeded tenant and user IDs for integration tests.
// These UUIDs match the seed data in apps/api/test/fixtures/seed.ts.
// ---------------------------------------------------------------------------

export const TENANT_A_ID = '00000000-0000-0000-0000-000000000001';
export const TENANT_B_ID = '00000000-0000-0000-0000-000000000002';

export const TENANT_A_STAFF_USER_ID = '00000000-0000-0000-0001-000000000001';
export const TENANT_B_STAFF_USER_ID = '00000000-0000-0000-0002-000000000001';

export const TENANT_A_PORTAL_USER_ID = '00000000-0000-0000-0001-000000000002';
export const TENANT_B_PORTAL_USER_ID = '00000000-0000-0000-0002-000000000002';

export const TENANT_A_ORG_ID = '00000000-0000-0000-0001-000000000010';
export const TENANT_B_ORG_ID = '00000000-0000-0000-0002-000000000010';

// ---------------------------------------------------------------------------
// Base factory
// ---------------------------------------------------------------------------

interface PrincipalContextOverrides {
  tenantId?: string;
  userId?: string;
  principalKind?: PrincipalKind;
  roles?: string[];
  orgScopeIds?: string[];
  traceId?: string;
  boundOrganizationId?: string;
}

function buildPrincipal(overrides: PrincipalContextOverrides): PrincipalContext {
  return {
    tenantId: overrides.tenantId ?? TENANT_A_ID,
    userId: overrides.userId ?? TENANT_A_STAFF_USER_ID,
    principalKind: overrides.principalKind ?? 'staff',
    roles: overrides.roles ?? ['agent'],
    orgScopeIds: overrides.orgScopeIds ?? [],
    traceId: overrides.traceId ?? randomUUID(),
    boundOrganizationId: overrides.boundOrganizationId,
  };
}

// ---------------------------------------------------------------------------
// Staff principals
// ---------------------------------------------------------------------------

/**
 * Staff principal for tenant A (agent role with full org scope).
 */
export function tenantAStaffPrincipal(
  overrides?: PrincipalContextOverrides,
): PrincipalContext {
  return buildPrincipal({
    tenantId: TENANT_A_ID,
    userId: TENANT_A_STAFF_USER_ID,
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds: [TENANT_A_ORG_ID],
    ...overrides,
  });
}

/**
 * Staff principal for tenant B (agent role with full org scope).
 */
export function tenantBStaffPrincipal(
  overrides?: PrincipalContextOverrides,
): PrincipalContext {
  return buildPrincipal({
    tenantId: TENANT_B_ID,
    userId: TENANT_B_STAFF_USER_ID,
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds: [TENANT_B_ORG_ID],
    ...overrides,
  });
}

/**
 * Staff principal with admin/manager roles.
 */
export function tenantAAdminPrincipal(
  overrides?: PrincipalContextOverrides,
): PrincipalContext {
  return buildPrincipal({
    tenantId: TENANT_A_ID,
    userId: TENANT_A_STAFF_USER_ID,
    principalKind: 'staff',
    roles: ['admin', 'manager', 'agent'],
    orgScopeIds: [TENANT_A_ORG_ID],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Portal principals
// ---------------------------------------------------------------------------

/**
 * Portal (customer end-user) principal for tenant A.
 * boundOrganizationId is set to TENANT_A_ORG_ID by default — portal principals
 * are always bound to exactly one organisation.
 */
export function tenantAPortalPrincipal(
  overrides?: PrincipalContextOverrides,
): PrincipalContext {
  return buildPrincipal({
    tenantId: TENANT_A_ID,
    userId: TENANT_A_PORTAL_USER_ID,
    principalKind: 'portal',
    roles: ['portal_user'],
    orgScopeIds: [TENANT_A_ORG_ID],
    boundOrganizationId: TENANT_A_ORG_ID,
    ...overrides,
  });
}

/**
 * Portal principal for tenant B.
 */
export function tenantBPortalPrincipal(
  overrides?: PrincipalContextOverrides,
): PrincipalContext {
  return buildPrincipal({
    tenantId: TENANT_B_ID,
    userId: TENANT_B_PORTAL_USER_ID,
    principalKind: 'portal',
    roles: ['portal_user'],
    orgScopeIds: [TENANT_B_ORG_ID],
    boundOrganizationId: TENANT_B_ORG_ID,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Machine principals
// ---------------------------------------------------------------------------

/**
 * Machine (worker/webhook) principal for tenant A.
 * Used by Jira sync worker and webhook receiver integration tests.
 */
export function tenantAMachinePrincipal(
  overrides?: PrincipalContextOverrides,
): PrincipalContext {
  return buildPrincipal({
    tenantId: TENANT_A_ID,
    userId: TENANT_A_STAFF_USER_ID, // system user representing the worker
    principalKind: 'machine',
    roles: ['machine'],
    orgScopeIds: [],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Express request mock helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal Express-like request mock with the given principal attached
 * as request.user in the shape expected by the JWT auth guard.
 *
 * Use this in interceptor unit tests to simulate an authenticated request
 * without going through the full NestJS HTTP layer.
 */
export function buildMockRequest(
  principal: PrincipalContext,
  overrides?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  },
): {
  user: {
    sub: string;
    tenantId: string;
    principalKind: PrincipalKind;
    roles: string[];
    orgScopeIds: string[];
    boundOrganizationId?: string;
  };
  url: string;
  method: string;
  headers: Record<string, string>;
} {
  return {
    user: {
      sub: principal.userId,
      tenantId: principal.tenantId,
      principalKind: principal.principalKind,
      roles: principal.roles,
      orgScopeIds: principal.orgScopeIds,
      boundOrganizationId: principal.boundOrganizationId,
    },
    url: overrides?.url ?? '/api/v1/tickets',
    method: overrides?.method ?? 'GET',
    headers: {
      'x-trace-id': principal.traceId,
      ...overrides?.headers,
    },
  };
}
