/**
 * Principal token minting for the isolation harness.
 *
 * Issues valid RS256 access tokens for all principal types in both tenants.
 * Builds on top of rbac.fixtures.ts (which provides the underlying JWT signing)
 * and uses the deterministic IDs from tenant-factory.ts.
 */

import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

import { getTestSigningKeyPair, TEST_KID, TEST_ISSUER, TEST_AUDIENCE } from './session.fixtures';
import {
  HARNESS_TENANT_A_ID,
  HARNESS_TENANT_B_ID,
  HARNESS_TENANT_A_ADMIN_ID,
  HARNESS_TENANT_A_MANAGER_ID,
  HARNESS_TENANT_A_AGENT1_ID,
  HARNESS_TENANT_A_AGENT2_ID,
  HARNESS_TENANT_A_LEAD_ID,
  HARNESS_TENANT_A_PORTAL1_ID,
  HARNESS_TENANT_A_PORTAL2_ID,
  HARNESS_TENANT_B_ADMIN_ID,
  HARNESS_TENANT_B_MANAGER_ID,
  HARNESS_TENANT_B_AGENT1_ID,
  HARNESS_TENANT_B_LEAD_ID,
  HARNESS_TENANT_B_PORTAL1_ID,
  HARNESS_TENANT_A_ORG1_ID,
  HARNESS_TENANT_A_ORG2_ID,
  HARNESS_TENANT_B_ORG1_ID,
} from './tenant-factory';

// ---------------------------------------------------------------------------
// Token minting
// ---------------------------------------------------------------------------

interface HarnessMintOptions {
  userId: string;
  tenantId: string;
  roles: string[];
  userType: 'staff' | 'portal' | 'machine';
  orgScopeVersion?: number;
  boundOrgId?: string;
}

function mintHarnessToken(opts: HarnessMintOptions): string {
  const { privateKeyPem } = getTestSigningKeyPair();
  return jwt.sign(
    {
      sub: opts.userId,
      tenant_id: opts.tenantId,
      roles: opts.roles,
      org_scope_version: opts.orgScopeVersion ?? 1,
      user_type: opts.userType,
      ...(opts.boundOrgId ? { bound_org_id: opts.boundOrgId } : {}),
      jti: randomUUID(),
      iss: TEST_ISSUER,
      aud: TEST_AUDIENCE,
    },
    privateKeyPem,
    { algorithm: 'RS256', expiresIn: 900, keyid: TEST_KID },
  );
}

// ---------------------------------------------------------------------------
// Pre-minted tokens for Tenant A
// ---------------------------------------------------------------------------

/** Admin in tenant A — all permissions, tenant-wide org scope. */
export const TOKEN_A_ADMIN = mintHarnessToken({
  userId: HARNESS_TENANT_A_ADMIN_ID,
  tenantId: HARNESS_TENANT_A_ID,
  roles: ['admin'],
  userType: 'staff',
});

/** Manager in tenant A — can manage org scopes. */
export const TOKEN_A_MANAGER = mintHarnessToken({
  userId: HARNESS_TENANT_A_MANAGER_ID,
  tenantId: HARNESS_TENANT_A_ID,
  roles: ['manager'],
  userType: 'staff',
});

/** Agent in tenant A scoped to org 1 only. */
export const TOKEN_A_AGENT_ORG1 = mintHarnessToken({
  userId: HARNESS_TENANT_A_AGENT1_ID,
  tenantId: HARNESS_TENANT_A_ID,
  roles: ['agent'],
  userType: 'staff',
  orgScopeVersion: 1,
});

/** Agent in tenant A scoped to org 2 only. */
export const TOKEN_A_AGENT_ORG2 = mintHarnessToken({
  userId: HARNESS_TENANT_A_AGENT2_ID,
  tenantId: HARNESS_TENANT_A_ID,
  roles: ['agent'],
  userType: 'staff',
  orgScopeVersion: 1,
});

/** Lead analyst in tenant A — tenant-wide read, no mutation. */
export const TOKEN_A_LEAD = mintHarnessToken({
  userId: HARNESS_TENANT_A_LEAD_ID,
  tenantId: HARNESS_TENANT_A_ID,
  roles: ['lead_analyst'],
  userType: 'staff',
});

/** Portal user in tenant A bound to org 1. */
export const TOKEN_A_PORTAL_ORG1 = mintHarnessToken({
  userId: HARNESS_TENANT_A_PORTAL1_ID,
  tenantId: HARNESS_TENANT_A_ID,
  roles: ['portal_user'],
  userType: 'portal',
  boundOrgId: HARNESS_TENANT_A_ORG1_ID,
});

/** Portal user in tenant A bound to org 2. */
export const TOKEN_A_PORTAL_ORG2 = mintHarnessToken({
  userId: HARNESS_TENANT_A_PORTAL2_ID,
  tenantId: HARNESS_TENANT_A_ID,
  roles: ['portal_user'],
  userType: 'portal',
  boundOrgId: HARNESS_TENANT_A_ORG2_ID,
});

// ---------------------------------------------------------------------------
// Pre-minted tokens for Tenant B
// ---------------------------------------------------------------------------

export const TOKEN_B_ADMIN = mintHarnessToken({
  userId: HARNESS_TENANT_B_ADMIN_ID,
  tenantId: HARNESS_TENANT_B_ID,
  roles: ['admin'],
  userType: 'staff',
});

export const TOKEN_B_MANAGER = mintHarnessToken({
  userId: HARNESS_TENANT_B_MANAGER_ID,
  tenantId: HARNESS_TENANT_B_ID,
  roles: ['manager'],
  userType: 'staff',
});

export const TOKEN_B_AGENT_ORG1 = mintHarnessToken({
  userId: HARNESS_TENANT_B_AGENT1_ID,
  tenantId: HARNESS_TENANT_B_ID,
  roles: ['agent'],
  userType: 'staff',
  orgScopeVersion: 1,
});

export const TOKEN_B_LEAD = mintHarnessToken({
  userId: HARNESS_TENANT_B_LEAD_ID,
  tenantId: HARNESS_TENANT_B_ID,
  roles: ['lead_analyst'],
  userType: 'staff',
});

export const TOKEN_B_PORTAL_ORG1 = mintHarnessToken({
  userId: HARNESS_TENANT_B_PORTAL1_ID,
  tenantId: HARNESS_TENANT_B_ID,
  roles: ['portal_user'],
  userType: 'portal',
  boundOrgId: HARNESS_TENANT_B_ORG1_ID,
});

// ---------------------------------------------------------------------------
// Stale-version token (for SCOPE_VERSION_STALE assertions)
// ---------------------------------------------------------------------------

/** Token with org_scope_version=0 — will be stale once agent scopes are saved (version=1). */
export const TOKEN_A_AGENT_STALE_VERSION = mintHarnessToken({
  userId: HARNESS_TENANT_A_AGENT1_ID,
  tenantId: HARNESS_TENANT_A_ID,
  roles: ['agent'],
  userType: 'staff',
  orgScopeVersion: 0,
});

// ---------------------------------------------------------------------------
// Summary map for iteration in suites
// ---------------------------------------------------------------------------

export interface HarnessPrincipal {
  token: string;
  tenantId: string;
  userId: string;
  roles: string[];
  label: string;
}

export const ALL_HARNESS_PRINCIPALS: HarnessPrincipal[] = [
  { token: TOKEN_A_ADMIN,       tenantId: HARNESS_TENANT_A_ID, userId: HARNESS_TENANT_A_ADMIN_ID,   roles: ['admin'],       label: 'A-admin' },
  { token: TOKEN_A_MANAGER,     tenantId: HARNESS_TENANT_A_ID, userId: HARNESS_TENANT_A_MANAGER_ID, roles: ['manager'],     label: 'A-manager' },
  { token: TOKEN_A_AGENT_ORG1,  tenantId: HARNESS_TENANT_A_ID, userId: HARNESS_TENANT_A_AGENT1_ID,  roles: ['agent'],       label: 'A-agent-org1' },
  { token: TOKEN_A_AGENT_ORG2,  tenantId: HARNESS_TENANT_A_ID, userId: HARNESS_TENANT_A_AGENT2_ID,  roles: ['agent'],       label: 'A-agent-org2' },
  { token: TOKEN_A_LEAD,        tenantId: HARNESS_TENANT_A_ID, userId: HARNESS_TENANT_A_LEAD_ID,    roles: ['lead_analyst'], label: 'A-lead' },
  { token: TOKEN_B_ADMIN,       tenantId: HARNESS_TENANT_B_ID, userId: HARNESS_TENANT_B_ADMIN_ID,   roles: ['admin'],       label: 'B-admin' },
  { token: TOKEN_B_MANAGER,     tenantId: HARNESS_TENANT_B_ID, userId: HARNESS_TENANT_B_MANAGER_ID, roles: ['manager'],     label: 'B-manager' },
  { token: TOKEN_B_AGENT_ORG1,  tenantId: HARNESS_TENANT_B_ID, userId: HARNESS_TENANT_B_AGENT1_ID,  roles: ['agent'],       label: 'B-agent-org1' },
];
