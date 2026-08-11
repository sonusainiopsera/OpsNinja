/**
 * Deterministic two-tenant fixture factory for isolation harness.
 *
 * Builds a complete multi-tenant graph through direct SQL (bypassing RLS)
 * using fixed UUIDs so failures are reproducible. Deliberately uses colliding
 * names across tenants to catch identifier-based logic errors.
 *
 * Graph per tenant:
 *   - 1 tenant
 *   - 2 organizations (with intentionally colliding names across tenants)
 *   - 4 users: admin, manager, agent-scoped-to-org-A, agent-scoped-to-org-B
 *   - 1 portal user per organization
 *   - 3 tickets per organization
 *   - 2 public + 2 internal comments per ticket
 *   - agent_org_scopes rows binding agents to their org
 */

import { PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// Deterministic IDs — use prefix ranges to keep tenants visually distinct
// ---------------------------------------------------------------------------

export const HARNESS_TENANT_A_ID  = 'f0000000-0000-0000-0000-000000000001';
export const HARNESS_TENANT_B_ID  = 'f0000000-0000-0000-0000-000000000002';

// Organizations — same names to test collision safety
export const HARNESS_TENANT_A_ORG1_ID = 'f0000001-0000-0000-0000-000000000001';
export const HARNESS_TENANT_A_ORG2_ID = 'f0000001-0000-0000-0000-000000000002';
export const HARNESS_TENANT_B_ORG1_ID = 'f0000001-0000-0000-0000-000000000003';
export const HARNESS_TENANT_B_ORG2_ID = 'f0000001-0000-0000-0000-000000000004';

// Users
export const HARNESS_TENANT_A_ADMIN_ID   = 'f0000002-0000-0000-0000-000000000001';
export const HARNESS_TENANT_A_MANAGER_ID = 'f0000002-0000-0000-0000-000000000002';
export const HARNESS_TENANT_A_AGENT1_ID  = 'f0000002-0000-0000-0000-000000000003'; // scoped to org1
export const HARNESS_TENANT_A_AGENT2_ID  = 'f0000002-0000-0000-0000-000000000004'; // scoped to org2
export const HARNESS_TENANT_A_LEAD_ID    = 'f0000002-0000-0000-0000-000000000005';
export const HARNESS_TENANT_A_PORTAL1_ID = 'f0000002-0000-0000-0000-000000000006'; // bound to org1
export const HARNESS_TENANT_A_PORTAL2_ID = 'f0000002-0000-0000-0000-000000000007'; // bound to org2

export const HARNESS_TENANT_B_ADMIN_ID   = 'f0000003-0000-0000-0000-000000000001';
export const HARNESS_TENANT_B_MANAGER_ID = 'f0000003-0000-0000-0000-000000000002';
export const HARNESS_TENANT_B_AGENT1_ID  = 'f0000003-0000-0000-0000-000000000003'; // scoped to org1
export const HARNESS_TENANT_B_AGENT2_ID  = 'f0000003-0000-0000-0000-000000000004'; // scoped to org2
export const HARNESS_TENANT_B_LEAD_ID    = 'f0000003-0000-0000-0000-000000000005';
export const HARNESS_TENANT_B_PORTAL1_ID = 'f0000003-0000-0000-0000-000000000006'; // bound to org1
export const HARNESS_TENANT_B_PORTAL2_ID = 'f0000003-0000-0000-0000-000000000007'; // bound to org2

// Tickets — 3 per org, 2 tenants × 2 orgs × 3 tickets = 12
export const HARNESS_TICKET_A_ORG1 = [
  'f0000010-0000-0000-0000-000000000001',
  'f0000010-0000-0000-0000-000000000002',
  'f0000010-0000-0000-0000-000000000003',
];
export const HARNESS_TICKET_A_ORG2 = [
  'f0000010-0000-0000-0000-000000000004',
  'f0000010-0000-0000-0000-000000000005',
  'f0000010-0000-0000-0000-000000000006',
];
export const HARNESS_TICKET_B_ORG1 = [
  'f0000010-0000-0000-0000-000000000007',
  'f0000010-0000-0000-0000-000000000008',
  'f0000010-0000-0000-0000-000000000009',
];
export const HARNESS_TICKET_B_ORG2 = [
  'f0000010-0000-0000-0000-00000000000a',
  'f0000010-0000-0000-0000-00000000000b',
  'f0000010-0000-0000-0000-00000000000c',
];

// Comments — 2 public + 2 internal per first ticket of each org/tenant combo
export const HARNESS_COMMENT_A_ORG1_PUBLIC1   = 'f0000020-0000-0000-0000-000000000001';
export const HARNESS_COMMENT_A_ORG1_PUBLIC2   = 'f0000020-0000-0000-0000-000000000002';
export const HARNESS_COMMENT_A_ORG1_INTERNAL1 = 'f0000020-0000-0000-0000-000000000003';
export const HARNESS_COMMENT_A_ORG1_INTERNAL2 = 'f0000020-0000-0000-0000-000000000004';

export interface HarnessResult {
  tenantAId: string;
  tenantBId: string;
  tenantAOrg1Id: string;
  tenantAOrg2Id: string;
  tenantBOrg1Id: string;
  tenantBOrg2Id: string;
}

/**
 * Seeds the full two-tenant harness graph.
 * Must be called with a superuser / migrator-role connection so RLS is bypassed.
 */
export async function seedHarnessData(client: PoolClient): Promise<HarnessResult> {
  await client.query('BEGIN');
  try {
    // Tenants — same slug prefix, different suffix to catch slug collisions
    await client.query(
      `INSERT INTO tenants (id, name, slug, active) VALUES
        ($1, 'Acme Corp', 'acme',      true),
        ($2, 'Acme Corp', 'acme-test', true)
       ON CONFLICT (id) DO NOTHING`,
      [HARNESS_TENANT_A_ID, HARNESS_TENANT_B_ID],
    );

    // Organizations — intentionally same names across tenants (collision test)
    await client.query(
      `INSERT INTO organizations (id, tenant_id, name, tier) VALUES
        ($1, $2, 'Global Support', 'enterprise'),
        ($3, $2, 'EMEA Support',   'standard'),
        ($4, $5, 'Global Support', 'enterprise'),
        ($6, $5, 'EMEA Support',   'standard')
       ON CONFLICT (id) DO NOTHING`,
      [
        HARNESS_TENANT_A_ORG1_ID, HARNESS_TENANT_A_ID,
        HARNESS_TENANT_A_ORG2_ID, HARNESS_TENANT_A_ORG2_ID,
        HARNESS_TENANT_B_ORG1_ID, HARNESS_TENANT_B_ID,
        HARNESS_TENANT_B_ORG2_ID,
      ],
    );

    // Rebuild org insert more clearly
    await client.query('DELETE FROM organizations WHERE id = ANY($1)', [[
      HARNESS_TENANT_A_ORG1_ID, HARNESS_TENANT_A_ORG2_ID,
      HARNESS_TENANT_B_ORG1_ID, HARNESS_TENANT_B_ORG2_ID,
    ]]);
    await client.query(
      `INSERT INTO organizations (id, tenant_id, name, tier) VALUES
        ($1, $2, 'Global Support', 'enterprise'),
        ($3, $2, 'EMEA Support',   'standard'),
        ($4, $5, 'Global Support', 'enterprise'),
        ($6, $5, 'EMEA Support',   'standard')`,
      [
        HARNESS_TENANT_A_ORG1_ID, HARNESS_TENANT_A_ID,
        HARNESS_TENANT_A_ORG2_ID, HARNESS_TENANT_A_ID,
        HARNESS_TENANT_B_ORG1_ID, HARNESS_TENANT_B_ID,
        HARNESS_TENANT_B_ORG2_ID, HARNESS_TENANT_B_ID,
      ],
    );

    // Users — same email local-part across tenants (deliberate collision)
    await client.query(
      `INSERT INTO users (id, tenant_id, email, principal_kind) VALUES
        ($1,  $2,  'admin@example.com',   'staff'),
        ($3,  $2,  'manager@example.com', 'staff'),
        ($4,  $2,  'agent1@example.com',  'staff'),
        ($5,  $2,  'agent2@example.com',  'staff'),
        ($6,  $2,  'lead@example.com',    'staff'),
        ($7,  $2,  'portal1@example.com', 'portal'),
        ($8,  $2,  'portal2@example.com', 'portal'),
        ($9,  $10, 'admin@example.com',   'staff'),
        ($11, $10, 'manager@example.com', 'staff'),
        ($12, $10, 'agent1@example.com',  'staff'),
        ($13, $10, 'agent2@example.com',  'staff'),
        ($14, $10, 'lead@example.com',    'staff'),
        ($15, $10, 'portal1@example.com', 'portal'),
        ($16, $10, 'portal2@example.com', 'portal')
       ON CONFLICT (id) DO NOTHING`,
      [
        HARNESS_TENANT_A_ADMIN_ID,   HARNESS_TENANT_A_ID,
        HARNESS_TENANT_A_MANAGER_ID,
        HARNESS_TENANT_A_AGENT1_ID,
        HARNESS_TENANT_A_AGENT2_ID,
        HARNESS_TENANT_A_LEAD_ID,
        HARNESS_TENANT_A_PORTAL1_ID,
        HARNESS_TENANT_A_PORTAL2_ID,
        HARNESS_TENANT_B_ADMIN_ID,   HARNESS_TENANT_B_ID,
        HARNESS_TENANT_B_MANAGER_ID,
        HARNESS_TENANT_B_AGENT1_ID,
        HARNESS_TENANT_B_AGENT2_ID,
        HARNESS_TENANT_B_LEAD_ID,
        HARNESS_TENANT_B_PORTAL1_ID,
        HARNESS_TENANT_B_PORTAL2_ID,
      ],
    );

    // Tickets — 3 per org per tenant
    const ticketRows: [string, string, string, string, string][] = [
      ...HARNESS_TICKET_A_ORG1.map((id, i) => [id, HARNESS_TENANT_A_ID, HARNESS_TENANT_A_ORG1_ID, `A-Org1 Ticket ${i + 1}`, 'P2'] as [string, string, string, string, string]),
      ...HARNESS_TICKET_A_ORG2.map((id, i) => [id, HARNESS_TENANT_A_ID, HARNESS_TENANT_A_ORG2_ID, `A-Org2 Ticket ${i + 1}`, 'P3'] as [string, string, string, string, string]),
      ...HARNESS_TICKET_B_ORG1.map((id, i) => [id, HARNESS_TENANT_B_ID, HARNESS_TENANT_B_ORG1_ID, `B-Org1 Ticket ${i + 1}`, 'P2'] as [string, string, string, string, string]),
      ...HARNESS_TICKET_B_ORG2.map((id, i) => [id, HARNESS_TENANT_B_ID, HARNESS_TENANT_B_ORG2_ID, `B-Org2 Ticket ${i + 1}`, 'P3'] as [string, string, string, string, string]),
    ];

    for (const [id, tenantId, orgId, subject, priority] of ticketRows) {
      await client.query(
        `INSERT INTO tickets (id, tenant_id, organization_id, subject, status, priority)
         VALUES ($1, $2, $3, $4, 'open', $5) ON CONFLICT (id) DO NOTHING`,
        [id, tenantId, orgId, subject, priority],
      );
    }

    // Comments — 2 public + 2 internal on first ticket of A-Org1
    const firstTicketAOrg1 = HARNESS_TICKET_A_ORG1[0];
    await client.query(
      `INSERT INTO ticket_comments (id, tenant_id, ticket_id, organization_id, body, visibility)
       VALUES
        ($1, $5, $6, $7, 'Public comment 1', 'public'),
        ($2, $5, $6, $7, 'Public comment 2', 'public'),
        ($3, $5, $6, $7, 'Internal note 1',  'internal'),
        ($4, $5, $6, $7, 'Internal note 2',  'internal')
       ON CONFLICT (id) DO NOTHING`,
      [
        HARNESS_COMMENT_A_ORG1_PUBLIC1,
        HARNESS_COMMENT_A_ORG1_PUBLIC2,
        HARNESS_COMMENT_A_ORG1_INTERNAL1,
        HARNESS_COMMENT_A_ORG1_INTERNAL2,
        HARNESS_TENANT_A_ID,
        firstTicketAOrg1,
        HARNESS_TENANT_A_ORG1_ID,
      ],
    );

    // Agent org scopes
    await client.query(
      `INSERT INTO agent_org_scopes (tenant_id, user_id, organization_id, access_level, scope_version)
       VALUES
        ($1, $3, $5, 'full', 1),
        ($1, $4, $6, 'full', 1),
        ($2, $7, $8, 'full', 1),
        ($2, $9, $10, 'full', 1)
       ON CONFLICT (tenant_id, user_id, organization_id) DO NOTHING`,
      [
        HARNESS_TENANT_A_ID,
        HARNESS_TENANT_B_ID,
        HARNESS_TENANT_A_AGENT1_ID,
        HARNESS_TENANT_A_AGENT2_ID,
        HARNESS_TENANT_A_ORG1_ID,
        HARNESS_TENANT_A_ORG2_ID,
        HARNESS_TENANT_B_AGENT1_ID,
        HARNESS_TENANT_B_AGENT2_ID,
        HARNESS_TENANT_B_ORG1_ID,
        HARNESS_TENANT_B_ORG2_ID,
      ],
    );

    await client.query('COMMIT');
    return {
      tenantAId: HARNESS_TENANT_A_ID,
      tenantBId: HARNESS_TENANT_B_ID,
      tenantAOrg1Id: HARNESS_TENANT_A_ORG1_ID,
      tenantAOrg2Id: HARNESS_TENANT_A_ORG2_ID,
      tenantBOrg1Id: HARNESS_TENANT_B_ORG1_ID,
      tenantBOrg2Id: HARNESS_TENANT_B_ORG2_ID,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/**
 * Removes all harness data in FK-safe reverse order.
 */
export async function teardownHarnessData(client: PoolClient): Promise<void> {
  await client.query('BEGIN');
  try {
    const allTenantIds = [HARNESS_TENANT_A_ID, HARNESS_TENANT_B_ID];
    await client.query('DELETE FROM agent_org_scopes WHERE tenant_id = ANY($1)', [allTenantIds]);
    await client.query('DELETE FROM ticket_comments WHERE tenant_id = ANY($1)', [allTenantIds]);
    await client.query('DELETE FROM tickets WHERE tenant_id = ANY($1)', [allTenantIds]);
    await client.query('DELETE FROM users WHERE tenant_id = ANY($1)', [allTenantIds]);
    await client.query('DELETE FROM organizations WHERE tenant_id = ANY($1)', [allTenantIds]);
    await client.query('DELETE FROM tenants WHERE id = ANY($1)', [allTenantIds]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}
