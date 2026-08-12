/**
 * Shared deterministic seed module for the ticketing isolation and lifecycle
 * test suites — WO-043.
 *
 * Produces a fully reproducible graph across all ticketing suites:
 *   2 tenants (Alpha, Beta)
 *   4 organisations  (2 per tenant, intentionally colliding names)
 *   3 agents with differing org scopes (agent-org1-only, agent-org2-only, agent-all)
 *   1 portal user per tenant
 *   DevOps taxonomy (category tree)
 *   Tags, assignment groups, saved views
 *   Mixed-visibility threads (public + internal comments per ticket)
 *
 * All IDs are fixed-format UUIDs so assertions are reproducible across machines.
 * No Date.now(), no Math.random() — timestamps use epoch offsets only.
 *
 * Usage:
 *   import { seedSharedFixture, SHARED_IDS } from './shared-seed';
 *   await seedSharedFixture(client);
 *   // then use SHARED_IDS.TENANT_A, SHARED_IDS.TICKET_A1, etc.
 */

import type { PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// Deterministic IDs — prefix ranges keep tenants visually distinct
// ---------------------------------------------------------------------------

/** All deterministic IDs used by the shared seed.  Import these in test files. */
export const SHARED_IDS = {
  // Tenants
  TENANT_A: 'e0000001-0000-0000-0000-000000000001',
  TENANT_B: 'e0000001-0000-0000-0000-000000000002',

  // Organisations
  TENANT_A_ORG1: 'e0000002-0000-0000-0000-000000000001',
  TENANT_A_ORG2: 'e0000002-0000-0000-0000-000000000002',
  TENANT_B_ORG1: 'e0000002-0000-0000-0000-000000000003',
  TENANT_B_ORG2: 'e0000002-0000-0000-0000-000000000004',

  // Users — Tenant A
  TENANT_A_ADMIN:       'e0000003-0000-0000-0000-000000000001',
  TENANT_A_AGENT_ORG1:  'e0000003-0000-0000-0000-000000000002', // scoped to org1 only
  TENANT_A_AGENT_ORG2:  'e0000003-0000-0000-0000-000000000003', // scoped to org2 only
  TENANT_A_AGENT_ALL:   'e0000003-0000-0000-0000-000000000004', // scoped to org1 + org2
  TENANT_A_PORTAL1:     'e0000003-0000-0000-0000-000000000005', // bound to org1
  TENANT_A_PORTAL2:     'e0000003-0000-0000-0000-000000000006', // bound to org2

  // Users — Tenant B
  TENANT_B_ADMIN:       'e0000004-0000-0000-0000-000000000001',
  TENANT_B_AGENT_ORG1:  'e0000004-0000-0000-0000-000000000002',
  TENANT_B_AGENT_ALL:   'e0000004-0000-0000-0000-000000000003',
  TENANT_B_PORTAL1:     'e0000004-0000-0000-0000-000000000004',

  // Categories — DevOps taxonomy (shallow tree, two levels)
  CAT_ROOT:         'e0000005-0000-0000-0000-000000000001', // DevOps
  CAT_INFRA:        'e0000005-0000-0000-0000-000000000002', // Infrastructure
  CAT_DB:           'e0000005-0000-0000-0000-000000000003', // Database
  CAT_NETWORK:      'e0000005-0000-0000-0000-000000000004', // Network
  CAT_CICD:         'e0000005-0000-0000-0000-000000000005', // CI/CD

  // Tags (tenant A)
  TAG_CUSTOMER_IMPACT: 'e0000006-0000-0000-0000-000000000001',
  TAG_DATABASE:        'e0000006-0000-0000-0000-000000000002',
  TAG_URGENT:          'e0000006-0000-0000-0000-000000000003',
  TAG_INTERNAL:        'e0000006-0000-0000-0000-000000000004',

  // Assignment groups (tenant A)
  GROUP_SRE:     'e0000007-0000-0000-0000-000000000001',
  GROUP_DBA:     'e0000007-0000-0000-0000-000000000002',

  // Saved views (tenant A)
  VIEW_ALL_OPEN:    'e0000008-0000-0000-0000-000000000001',
  VIEW_MY_TICKETS:  'e0000008-0000-0000-0000-000000000002',
  VIEW_P1_OPEN:     'e0000008-0000-0000-0000-000000000003',

  // Tickets — Tenant A Org 1
  TICKET_A1: 'e0000010-0000-0000-0000-000000000001',
  TICKET_A2: 'e0000010-0000-0000-0000-000000000002',
  TICKET_A3: 'e0000010-0000-0000-0000-000000000003',

  // Tickets — Tenant A Org 2
  TICKET_A4: 'e0000010-0000-0000-0000-000000000004',
  TICKET_A5: 'e0000010-0000-0000-0000-000000000005',

  // Tickets — Tenant B Org 1
  TICKET_B1: 'e0000010-0000-0000-0000-000000000006',
  TICKET_B2: 'e0000010-0000-0000-0000-000000000007',

  // Comments on TICKET_A1 — mixed visibility thread
  COMMENT_A1_PUB1:  'e0000020-0000-0000-0000-000000000001',
  COMMENT_A1_PUB2:  'e0000020-0000-0000-0000-000000000002',
  COMMENT_A1_INT1:  'e0000020-0000-0000-0000-000000000003', // internal
  COMMENT_A1_INT2:  'e0000020-0000-0000-0000-000000000004', // internal

  // Attachment on public comment
  ATTACH_A1_PUB:  'e0000030-0000-0000-0000-000000000001',
  // Attachment on internal comment
  ATTACH_A1_INT:  'e0000030-0000-0000-0000-000000000002',

  // Outbox lifecycle ticket (created fresh per lifecycle test run)
  TICKET_LIFECYCLE: 'e0000090-0000-0000-0000-000000000001',
} as const;

// ---------------------------------------------------------------------------
// Fixed epoch timestamps (deterministic, not Date.now())
// ---------------------------------------------------------------------------
const T0 = '2026-08-11 10:00:00+00';
const T1 = '2026-08-11 10:05:00+00';
const T2 = '2026-08-11 10:10:00+00';

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

/**
 * Seeds the shared two-tenant, four-org ticketing fixture.
 * Must be called with a superuser/migrator role connection (bypasses RLS).
 * All inserts use ON CONFLICT DO NOTHING so the function is idempotent.
 */
export async function seedSharedFixture(client: PoolClient): Promise<void> {
  // ── Tenants ──────────────────────────────────────────────────────────────
  await client.query(`
    INSERT INTO tenants (id, name, slug, active)
    VALUES
      ($1, 'Shared Fixture Alpha', 'shared-alpha', true),
      ($2, 'Shared Fixture Beta',  'shared-beta',  true)
    ON CONFLICT (id) DO NOTHING
  `, [SHARED_IDS.TENANT_A, SHARED_IDS.TENANT_B]);

  // ── Organisations ────────────────────────────────────────────────────────
  await client.query(`
    INSERT INTO organizations (id, tenant_id, name, tier)
    VALUES
      ($1, $5, 'Global Support',  'enterprise'),
      ($2, $5, 'EMEA Support',    'standard'),
      ($3, $6, 'Global Support',  'enterprise'),
      ($4, $6, 'APAC Support',    'standard')
    ON CONFLICT (id) DO NOTHING
  `, [
    SHARED_IDS.TENANT_A_ORG1, SHARED_IDS.TENANT_A_ORG2,
    SHARED_IDS.TENANT_B_ORG1, SHARED_IDS.TENANT_B_ORG2,
    SHARED_IDS.TENANT_A, SHARED_IDS.TENANT_B,
  ]);

  // ── Users ─────────────────────────────────────────────────────────────────
  await client.query(`
    INSERT INTO users (id, tenant_id, email, principal_kind)
    VALUES
      ($1,  $11, 'admin@example.com',      'staff'),
      ($2,  $11, 'agent-org1@example.com', 'staff'),
      ($3,  $11, 'agent-org2@example.com', 'staff'),
      ($4,  $11, 'agent-all@example.com',  'staff'),
      ($5,  $11, 'portal1@example.com',    'portal'),
      ($6,  $11, 'portal2@example.com',    'portal'),
      ($7,  $12, 'admin@example.com',      'staff'),
      ($8,  $12, 'agent-b1@example.com',   'staff'),
      ($9,  $12, 'agent-b2@example.com',   'staff'),
      ($10, $12, 'portal-b1@example.com',  'portal')
    ON CONFLICT (id) DO NOTHING
  `, [
    SHARED_IDS.TENANT_A_ADMIN,
    SHARED_IDS.TENANT_A_AGENT_ORG1,
    SHARED_IDS.TENANT_A_AGENT_ORG2,
    SHARED_IDS.TENANT_A_AGENT_ALL,
    SHARED_IDS.TENANT_A_PORTAL1,
    SHARED_IDS.TENANT_A_PORTAL2,
    SHARED_IDS.TENANT_B_ADMIN,
    SHARED_IDS.TENANT_B_AGENT_ORG1,
    SHARED_IDS.TENANT_B_AGENT_ALL,
    SHARED_IDS.TENANT_B_PORTAL1,
    SHARED_IDS.TENANT_A,
    SHARED_IDS.TENANT_B,
  ]);

  // ── Agent org scopes ──────────────────────────────────────────────────────
  await client.query(`
    INSERT INTO agent_org_scopes (tenant_id, user_id, organization_id, access_level, scope_version)
    VALUES
      ($1, $4,  $7,  'full', 1),
      ($1, $5,  $8,  'full', 1),
      ($1, $6,  $7,  'full', 1),
      ($1, $6,  $8,  'full', 1),
      ($2, $9,  $10, 'full', 1),
      ($2, $11, $10, 'full', 1),
      ($2, $11, $12, 'full', 1)
    ON CONFLICT (tenant_id, user_id, organization_id) DO NOTHING
  `, [
    SHARED_IDS.TENANT_A,                               // $1
    SHARED_IDS.TENANT_B,                               // $2
    SHARED_IDS.TENANT_A_ORG1,                          // $3 (unused, align with $4)
    SHARED_IDS.TENANT_A_AGENT_ORG1,                    // $4
    SHARED_IDS.TENANT_A_AGENT_ORG2,                    // $5
    SHARED_IDS.TENANT_A_AGENT_ALL,                     // $6
    SHARED_IDS.TENANT_A_ORG1,                          // $7
    SHARED_IDS.TENANT_A_ORG2,                          // $8
    SHARED_IDS.TENANT_B_AGENT_ORG1,                    // $9
    SHARED_IDS.TENANT_B_ORG1,                          // $10
    SHARED_IDS.TENANT_B_AGENT_ALL,                     // $11
    SHARED_IDS.TENANT_B_ORG2,                          // $12
  ]);

  // ── Tags ─────────────────────────────────────────────────────────────────
  // tag definitions live in the `tags` table (id, tenant_id, name, color);
  // ticket_tags is the join table (tenant_id, ticket_id, tag_id).
  await client.query(`
    INSERT INTO tags (id, tenant_id, name, color)
    VALUES
      ($1, $5, 'customer-impact', '#ef4444'),
      ($2, $5, 'database',        '#3b82f6'),
      ($3, $5, 'urgent',          '#f97316'),
      ($4, $5, 'internal',        '#8b5cf6')
    ON CONFLICT (id) DO NOTHING
  `, [
    SHARED_IDS.TAG_CUSTOMER_IMPACT,
    SHARED_IDS.TAG_DATABASE,
    SHARED_IDS.TAG_URGENT,
    SHARED_IDS.TAG_INTERNAL,
    SHARED_IDS.TENANT_A,
  ]);

  // ── Assignment groups ────────────────────────────────────────────────────
  await client.query(`
    INSERT INTO assignment_groups (id, tenant_id, name)
    VALUES
      ($1, $3, 'SRE'),
      ($2, $3, 'DBA')
    ON CONFLICT (id) DO NOTHING
  `, [
    SHARED_IDS.GROUP_SRE,
    SHARED_IDS.GROUP_DBA,
    SHARED_IDS.TENANT_A,
  ]);

  // ── Saved views ───────────────────────────────────────────────────────────
  // Column mapping: owner_user_id (not owner_id), filter_ast (not filter_spec),
  // scope 'shared'|'private' (not pinned boolean).
  await client.query(`
    INSERT INTO saved_views (id, tenant_id, owner_user_id, name, filter_ast, scope)
    VALUES
      ($1, $4, $5, 'All Open',   '{"status":["open","new"]}'::jsonb,                  'shared'),
      ($2, $4, $5, 'My Tickets', '{"assigneeId":"__current_user__"}'::jsonb,           'private'),
      ($3, $4, $5, 'P1 Open',    '{"priority":["P1"],"status":["open","new"]}'::jsonb, 'private')
    ON CONFLICT (id) DO NOTHING
  `, [
    SHARED_IDS.VIEW_ALL_OPEN,
    SHARED_IDS.VIEW_MY_TICKETS,
    SHARED_IDS.VIEW_P1_OPEN,
    SHARED_IDS.TENANT_A,
    SHARED_IDS.TENANT_A_ADMIN,
  ]);

  // ── Tickets ───────────────────────────────────────────────────────────────
  const tickets = [
    [SHARED_IDS.TICKET_A1, SHARED_IDS.TENANT_A, SHARED_IDS.TENANT_A_ORG1, 'Production DB pool exhausted',    'P1', 'open',     SHARED_IDS.CAT_DB,      SHARED_IDS.TENANT_A_AGENT_ORG1, T0],
    [SHARED_IDS.TICKET_A2, SHARED_IDS.TENANT_A, SHARED_IDS.TENANT_A_ORG1, 'CI pipeline broken on main',      'P2', 'open',     SHARED_IDS.CAT_CICD,    SHARED_IDS.TENANT_A_AGENT_ORG1, T1],
    [SHARED_IDS.TICKET_A3, SHARED_IDS.TENANT_A, SHARED_IDS.TENANT_A_ORG1, 'Network latency spike',           'P3', 'resolved', SHARED_IDS.CAT_NETWORK, SHARED_IDS.TENANT_A_AGENT_ORG1, T2],
    [SHARED_IDS.TICKET_A4, SHARED_IDS.TENANT_A, SHARED_IDS.TENANT_A_ORG2, 'Infra provisioning failed',       'P2', 'open',     SHARED_IDS.CAT_INFRA,   SHARED_IDS.TENANT_A_AGENT_ORG2, T1],
    [SHARED_IDS.TICKET_A5, SHARED_IDS.TENANT_A, SHARED_IDS.TENANT_A_ORG2, 'Disk usage alert on prod-db-01',  'P3', 'open',     SHARED_IDS.CAT_DB,      SHARED_IDS.TENANT_A_AGENT_ORG2, T2],
    [SHARED_IDS.TICKET_B1, SHARED_IDS.TENANT_B, SHARED_IDS.TENANT_B_ORG1, 'Beta tenant: API gateway 502s',   'P1', 'open',     null,                   null,                           T0],
    [SHARED_IDS.TICKET_B2, SHARED_IDS.TENANT_B, SHARED_IDS.TENANT_B_ORG1, 'Beta tenant: slow queries',       'P2', 'open',     null,                   null,                           T1],
  ] as const;

  for (const [id, tenantId, orgId, subject, priority, status, categoryId, assigneeId, createdAt] of tickets) {
    await client.query(`
      INSERT INTO tickets
        (id, tenant_id, organization_id, subject, priority, status, category_id, assignee_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $9::timestamptz)
      ON CONFLICT (id) DO NOTHING
    `, [id, tenantId, orgId, subject, priority, status, categoryId ?? null, assigneeId ?? null, createdAt]);
  }

  // ── Ticket tag associations ────────────────────────────────────────────────
  // ticket_tags is the join table (tenant_id, ticket_id, tag_id).
  await client.query(`
    INSERT INTO ticket_tags (tenant_id, ticket_id, tag_id)
    VALUES
      ($1, $3, $5),
      ($1, $3, $6),
      ($2, $4, $7)
    ON CONFLICT (tenant_id, ticket_id, tag_id) DO NOTHING
  `, [
    SHARED_IDS.TENANT_A,             // $1
    SHARED_IDS.TENANT_A,             // $2
    SHARED_IDS.TICKET_A1,            // $3
    SHARED_IDS.TICKET_A2,            // $4
    SHARED_IDS.TAG_CUSTOMER_IMPACT,  // $5
    SHARED_IDS.TAG_DATABASE,         // $6
    SHARED_IDS.TAG_URGENT,           // $7
  ]);

  // ── Mixed-visibility thread on TICKET_A1 ──────────────────────────────────
  await client.query(`
    INSERT INTO ticket_comments
      (id, tenant_id, ticket_id, organization_id, author_id, body, visibility, created_at, updated_at)
    VALUES
      ($1, $5, $9, $10, $11, 'Initial report from customer — DB writes failing.', 'public',   $12::timestamptz, $12::timestamptz),
      ($2, $5, $9, $10, $11, 'Checked slow query log. Long-running migration.',    'public',   $13::timestamptz, $13::timestamptz),
      ($3, $5, $9, $10, $11, 'INTERNAL: Escalated to DBA on-call. Do not share.', 'internal', $13::timestamptz, $13::timestamptz),
      ($4, $5, $9, $10, $11, 'INTERNAL: Root cause confirmed. Killing query now.', 'internal', $14::timestamptz, $14::timestamptz)
    ON CONFLICT (id) DO NOTHING
  `, [
    SHARED_IDS.COMMENT_A1_PUB1,   // $1
    SHARED_IDS.COMMENT_A1_PUB2,   // $2
    SHARED_IDS.COMMENT_A1_INT1,   // $3
    SHARED_IDS.COMMENT_A1_INT2,   // $4
    SHARED_IDS.TENANT_A,          // $5
    null, null, null,             // $6 $7 $8 (unused params — keep index aligned)
    SHARED_IDS.TICKET_A1,         // $9
    SHARED_IDS.TENANT_A_ORG1,     // $10
    SHARED_IDS.TENANT_A_AGENT_ORG1, // $11
    T0,                           // $12
    T1,                           // $13
    T2,                           // $14
  ]);

  // ── Attachments (one on public comment, one on internal) ─────────────────
  // Column mapping: mime_type (not content_type), file_size_bytes (not size_bytes),
  // s3_key (not storage_key). No visibility column — attachments use is_finalized flag.
  await client.query(`
    INSERT INTO ticket_attachments
      (id, tenant_id, ticket_id, comment_id, organization_id, filename, mime_type, file_size_bytes, s3_key, is_finalized)
    VALUES
      ($1, $3, $5, $7, $9,  'db-metrics.png',   'image/png',  48230, 'tickets/a1/db-metrics.png',  true),
      ($2, $3, $5, $8, $9,  'query-trace.txt',  'text/plain', 1024,  'tickets/a1/query-trace.txt', true)
    ON CONFLICT (id) DO NOTHING
  `, [
    SHARED_IDS.ATTACH_A1_PUB,     // $1
    SHARED_IDS.ATTACH_A1_INT,     // $2
    SHARED_IDS.TENANT_A,          // $3
    null,                         // $4 (unused)
    SHARED_IDS.TICKET_A1,         // $5
    null,                         // $6 (unused)
    SHARED_IDS.COMMENT_A1_PUB2,   // $7
    SHARED_IDS.COMMENT_A1_INT1,   // $8
    SHARED_IDS.TENANT_A_ORG1,     // $9
  ]);
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/**
 * Removes all shared-seed data in FK-safe reverse order.
 * Call in globalTeardown or afterAll.
 */
export async function teardownSharedFixture(client: PoolClient): Promise<void> {
  const tenantIds = [SHARED_IDS.TENANT_A, SHARED_IDS.TENANT_B];
  // Delete in FK-safe reverse order:
  await client.query('DELETE FROM ticket_attachments        WHERE tenant_id = ANY($1)', [tenantIds]);
  await client.query('DELETE FROM ticket_comments           WHERE tenant_id = ANY($1)', [tenantIds]);
  await client.query('DELETE FROM ticket_status_history     WHERE tenant_id = ANY($1)', [tenantIds]);
  // ticket_tags is the join table; tags holds the tag definitions.
  await client.query('DELETE FROM ticket_tags               WHERE tenant_id = ANY($1)', [tenantIds]);
  await client.query('DELETE FROM tags                      WHERE tenant_id = ANY($1)', [tenantIds]);
  await client.query('DELETE FROM tickets                   WHERE tenant_id = ANY($1)', [tenantIds]);
  await client.query('DELETE FROM tenant_sequences          WHERE tenant_id = ANY($1)', [tenantIds]);
  await client.query('DELETE FROM saved_views               WHERE tenant_id = ANY($1)', [tenantIds]);
  await client.query('DELETE FROM assignment_groups         WHERE tenant_id = ANY($1)', [tenantIds]);
  await client.query('DELETE FROM agent_org_scopes          WHERE tenant_id = ANY($1)', [tenantIds]);
  await client.query('DELETE FROM users                     WHERE tenant_id = ANY($1)', [tenantIds]);
  await client.query('DELETE FROM organizations             WHERE tenant_id = ANY($1)', [tenantIds]);
  await client.query('DELETE FROM tenants                   WHERE id        = ANY($1)', [tenantIds]);
}

// ---------------------------------------------------------------------------
// Helper — set the RLS tenant context on a connection
// ---------------------------------------------------------------------------

export async function setRlsTenant(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}
