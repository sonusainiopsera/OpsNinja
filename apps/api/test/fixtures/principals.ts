/**
 * Principal token helper for isolation tests.
 *
 * Mints valid access tokens for every role type in both seeded tenants.
 * Builds on the shared rbac.fixtures.ts test keypair so all test suites
 * share one verification configuration.
 *
 * Usage:
 *   import { TOKENS } from './principals';
 *   const res = await request(server)
 *     .get('/api/v1/...')
 *     .set('Authorization', `Bearer ${TOKENS.TENANT_A.admin}`);
 */

import {
  TEST_KEY_PAIR,
  TEST_ISSUER,
  STAFF_AUDIENCE,
  PORTAL_AUDIENCE,
  mintTestToken,
} from './rbac.fixtures';

import {
  TENANT_A_ID,
  TENANT_B_ID,
  ADMIN_A_ID,
  MANAGER_A_ID,
  AGENT_A1_ID,
  AGENT_A2_ID,
  LEAD_A_ID,
  READONLY_A_ID,
  PORTAL_A1_ID,
  PORTAL_A2_ID,
  ADMIN_B_ID,
  MANAGER_B_ID,
  AGENT_B1_ID,
  PORTAL_B1_ID,
  ORG_A1_ID,
  ORG_A2_ID,
  ORG_B1_ID,
} from './tenant-factory';

export { TEST_KEY_PAIR, TEST_ISSUER };

// ── Tenant A tokens ───────────────────────────────────────────────────────────

export const TOKENS = {
  TENANT_A: {
    admin: mintTestToken({
      userId: ADMIN_A_ID,
      tenantId: TENANT_A_ID,
      roles: ['admin'],
      audience: STAFF_AUDIENCE,
    }),
    manager: mintTestToken({
      userId: MANAGER_A_ID,
      tenantId: TENANT_A_ID,
      roles: ['manager'],
      audience: STAFF_AUDIENCE,
    }),
    /** Agent scoped to ORG_A1 only. */
    agentScopedToA1: mintTestToken({
      userId: AGENT_A1_ID,
      tenantId: TENANT_A_ID,
      roles: ['agent'],
      audience: STAFF_AUDIENCE,
    }),
    /** Agent scoped to ORG_A2 only. */
    agentScopedToA2: mintTestToken({
      userId: AGENT_A2_ID,
      tenantId: TENANT_A_ID,
      roles: ['agent'],
      audience: STAFF_AUDIENCE,
    }),
    lead: mintTestToken({
      userId: LEAD_A_ID,
      tenantId: TENANT_A_ID,
      roles: ['lead'],
      audience: STAFF_AUDIENCE,
    }),
    readonly: mintTestToken({
      userId: READONLY_A_ID,
      tenantId: TENANT_A_ID,
      roles: ['readonly'],
      audience: STAFF_AUDIENCE,
    }),
    /** Portal user bound to ORG_A1. */
    portalOrgA1: mintTestToken({
      userId: PORTAL_A1_ID,
      tenantId: TENANT_A_ID,
      roles: ['portal_user'],
      audience: PORTAL_AUDIENCE,
    }),
    /** Portal user bound to ORG_A2. */
    portalOrgA2: mintTestToken({
      userId: PORTAL_A2_ID,
      tenantId: TENANT_A_ID,
      roles: ['portal_user'],
      audience: PORTAL_AUDIENCE,
    }),
  },

  TENANT_B: {
    admin: mintTestToken({
      userId: ADMIN_B_ID,
      tenantId: TENANT_B_ID,
      roles: ['admin'],
      audience: STAFF_AUDIENCE,
    }),
    manager: mintTestToken({
      userId: MANAGER_B_ID,
      tenantId: TENANT_B_ID,
      roles: ['manager'],
      audience: STAFF_AUDIENCE,
    }),
    agentScopedToB1: mintTestToken({
      userId: AGENT_B1_ID,
      tenantId: TENANT_B_ID,
      roles: ['agent'],
      audience: STAFF_AUDIENCE,
    }),
    portalOrgB1: mintTestToken({
      userId: PORTAL_B1_ID,
      tenantId: TENANT_B_ID,
      roles: ['portal_user'],
      audience: PORTAL_AUDIENCE,
    }),
  },
} as const;

// ── Scope IDs for JWT org_scope_ids claim ────────────────────────────────────

export const SCOPE_IDS = {
  AGENT_A1: [ORG_A1_ID],
  AGENT_A2: [ORG_A2_ID],
  AGENT_B1: [ORG_B1_ID],
} as const;
