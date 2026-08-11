/**
 * Principal factory utilities for the WO-043 test suite — unit-tested helpers.
 *
 * Provides typed factory functions for constructing test principal objects
 * and JWT token stubs without hitting real auth infrastructure.
 *
 * These helpers are separate from apps/api/test/fixtures/principals.ts
 * (which mints real RS256 JWTs) so the suite helpers can be unit-tested
 * without a running NestJS application or key material.
 *
 * AC8 requirement: "helper utilities of the suite itself (fixture builders,
 * principal factories, matrix generators) have unit tests written and passing."
 */

import type { PrincipalContext } from '../../src/observability/request-context';

// ---------------------------------------------------------------------------
// Deterministic IDs — use a distinct prefix range (d0) for support principals
// ---------------------------------------------------------------------------

export const SUPPORT_TENANT_A   = 'd0000001-0000-0000-0000-000000000001';
export const SUPPORT_TENANT_B   = 'd0000001-0000-0000-0000-000000000002';
export const SUPPORT_ORG_1      = 'd0000002-0000-0000-0000-000000000001';
export const SUPPORT_ORG_2      = 'd0000002-0000-0000-0000-000000000002';
export const SUPPORT_USER_ADMIN = 'd0000003-0000-0000-0000-000000000001';
export const SUPPORT_USER_AGENT = 'd0000003-0000-0000-0000-000000000002';
export const SUPPORT_USER_PORTAL = 'd0000003-0000-0000-0000-000000000003';

// ---------------------------------------------------------------------------
// Principal factory options
// ---------------------------------------------------------------------------

export interface PrincipalFactoryOpts {
  tenantId?: string;
  userId?: string;
  roles?: string[];
  orgScopeIds?: string[];
  orgScopeVersion?: number;
  principalKind?: 'staff' | 'portal' | 'machine';
  boundOrgId?: string;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/** Build a staff admin principal scoped to the whole tenant. */
export function makeAdminPrincipal(
  opts: PrincipalFactoryOpts = {},
): PrincipalContext {
  return {
    tenantId: opts.tenantId ?? SUPPORT_TENANT_A,
    userId: opts.userId ?? SUPPORT_USER_ADMIN,
    roles: opts.roles ?? ['admin'],
    orgScopeIds: opts.orgScopeIds ?? [],          // admins bypass org scope
    orgScopeVersion: opts.orgScopeVersion ?? 1,
    principalKind: opts.principalKind ?? 'staff',
    traceId: `trace-admin-${(opts.userId ?? SUPPORT_USER_ADMIN).slice(-4)}`,
  };
}

/** Build an agent principal scoped to specific organisations. */
export function makeAgentPrincipal(
  orgScopeIds: string[],
  opts: PrincipalFactoryOpts = {},
): PrincipalContext {
  return {
    tenantId: opts.tenantId ?? SUPPORT_TENANT_A,
    userId: opts.userId ?? SUPPORT_USER_AGENT,
    roles: opts.roles ?? ['agent'],
    orgScopeIds,
    orgScopeVersion: opts.orgScopeVersion ?? 1,
    principalKind: 'staff',
    traceId: `trace-agent-${(opts.userId ?? SUPPORT_USER_AGENT).slice(-4)}`,
  };
}

/** Build a portal user principal bound to a specific organisation. */
export function makePortalPrincipal(
  boundOrgId: string,
  opts: PrincipalFactoryOpts = {},
): PrincipalContext {
  return {
    tenantId: opts.tenantId ?? SUPPORT_TENANT_A,
    userId: opts.userId ?? SUPPORT_USER_PORTAL,
    roles: opts.roles ?? ['portal_user'],
    orgScopeIds: [boundOrgId],
    orgScopeVersion: opts.orgScopeVersion ?? 1,
    principalKind: 'portal',
    traceId: `trace-portal-${(opts.userId ?? SUPPORT_USER_PORTAL).slice(-4)}`,
  };
}

/** Build a cross-tenant principal (Tenant B acting on Tenant A resources). */
export function makeCrossTenantPrincipal(
  opts: PrincipalFactoryOpts = {},
): PrincipalContext {
  return {
    tenantId: opts.tenantId ?? SUPPORT_TENANT_B,   // ← DIFFERENT tenant
    userId: opts.userId ?? SUPPORT_USER_ADMIN,
    roles: opts.roles ?? ['admin'],
    orgScopeIds: [],
    orgScopeVersion: opts.orgScopeVersion ?? 1,
    principalKind: 'staff',
    traceId: `trace-xtenant-${(opts.userId ?? SUPPORT_USER_ADMIN).slice(-4)}`,
  };
}

// ---------------------------------------------------------------------------
// Matrix generator
// ---------------------------------------------------------------------------

export interface PrincipalMatrixEntry {
  label: string;
  principal: PrincipalContext;
  expectedAccess: boolean;
}

/**
 * Builds a cross-org access matrix for a given target org.
 *
 * Returns entries for:
 *   - admin (always has access)
 *   - agent scoped to targetOrg (has access)
 *   - agent scoped to OTHER org (no access)
 *   - cross-tenant principal (no access)
 *   - portal user in targetOrg (portal access only)
 */
export function buildOrgAccessMatrix(
  targetOrgId: string,
  otherOrgId: string,
  opts: PrincipalFactoryOpts = {},
): PrincipalMatrixEntry[] {
  return [
    {
      label: 'admin (tenant-wide)',
      principal: makeAdminPrincipal(opts),
      expectedAccess: true,
    },
    {
      label: `agent scoped to target org (${targetOrgId.slice(-4)})`,
      principal: makeAgentPrincipal([targetOrgId], opts),
      expectedAccess: true,
    },
    {
      label: `agent scoped to other org only (${otherOrgId.slice(-4)})`,
      principal: makeAgentPrincipal([otherOrgId], opts),
      expectedAccess: false,
    },
    {
      label: 'cross-tenant admin',
      principal: makeCrossTenantPrincipal(opts),
      expectedAccess: false,
    },
    {
      label: `portal user in target org (${targetOrgId.slice(-4)})`,
      principal: makePortalPrincipal(targetOrgId, opts),
      expectedAccess: true,
    },
  ];
}

/**
 * Returns true when the principal should have access to a resource in targetOrgId,
 * based on the rules:
 *   - admin → always
 *   - agent → only if targetOrgId in orgScopeIds (or orgScopeIds empty = bypass for admins)
 *   - portal → only if orgScopeIds includes targetOrgId
 *   - cross-tenant → never
 */
export function principalHasOrgAccess(
  principal: PrincipalContext,
  resourceTenantId: string,
  targetOrgId: string,
): boolean {
  // Cross-tenant: never
  if (principal.tenantId !== resourceTenantId) return false;

  // Admin roles bypass org scope
  if (principal.roles.includes('admin') || principal.roles.includes('manager')) {
    return true;
  }

  // Agent / portal: check orgScopeIds
  return principal.orgScopeIds.includes(targetOrgId);
}
