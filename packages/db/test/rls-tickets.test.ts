/**
 * RLS characterization tests for the tickets-module tables (WO-031).
 *
 * Seeds two tenants and verifies that rows belonging to Tenant B are
 * completely invisible when app.current_tenant is set to Tenant A, across
 * every table owned by the tickets module.
 *
 * Each test runs inside a transaction that is rolled back on completion —
 * no data persists after the suite.
 *
 * Requires DATABASE_URL. Skipped in offline / unit-test runs.
 */

import { Pool, PoolClient } from 'pg';

const SKIP = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Fixed UUIDs
// ---------------------------------------------------------------------------

const TENANT_A = 'c1000001-0000-0000-0000-000000000001';
const TENANT_B = 'c1000001-0000-0000-0000-000000000002';

const ORG_A    = 'c1000002-0000-0000-0000-000000000001';
const ORG_B    = 'c1000002-0000-0000-0000-000000000002';

const TICKET_A = 'c1000003-0000-0000-0000-000000000001';
const TICKET_B = 'c1000003-0000-0000-0000-000000000002';

const COMMENT_B  = 'c1000004-0000-0000-0000-000000000001';
const ATTACH_B   = 'c1000005-0000-0000-0000-000000000001';
const TAG_B      = 'c1000006-0000-0000-0000-000000000001';
const GROUP_B    = 'c1000007-0000-0000-0000-000000000001';
const MEMBER_B   = 'c1000008-0000-0000-0000-000000000001';
const HISTORY_B  = 'c1000009-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setTenant(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

maybeDescribe('RLS tickets: cross-tenant isolation', () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');

    // Insert tenants (owner/superuser connection — bypasses RLS).
    await client.query(`
      INSERT INTO tenants (id, name, slug)
      VALUES ($1, 'RLS Tickets Tenant A', 'rls-tickets-a'),
             ($2, 'RLS Tickets Tenant B', 'rls-tickets-b')
      ON CONFLICT DO NOTHING
    `, [TENANT_A, TENANT_B]);

    // Insert one organization per tenant.
    await client.query(`SET LOCAL app.current_tenant = '${TENANT_A}'`);
    await client.query(`
      INSERT INTO organizations (id, tenant_id, name)
      VALUES ($1, $2, 'Ticket Org A')
      ON CONFLICT DO NOTHING
    `, [ORG_A, TENANT_A]);

    await client.query(`SET LOCAL app.current_tenant = '${TENANT_B}'`);
    await client.query(`
      INSERT INTO organizations (id, tenant_id, name)
      VALUES ($1, $2, 'Ticket Org B')
      ON CONFLICT DO NOTHING
    `, [ORG_B, TENANT_B]);

    // Insert seed rows for Tenant A (visible reference).
    await client.query(`SET LOCAL app.current_tenant = '${TENANT_A}'`);
    await client.query(`
      INSERT INTO tickets (id, tenant_id, organization_id, subject, status, priority)
      VALUES ($1, $2, $3, 'Ticket A subject', 'open', 'P3')
      ON CONFLICT DO NOTHING
    `, [TICKET_A, TENANT_A, ORG_A]);

    // Insert seed rows for Tenant B (must be invisible to Tenant A).
    await client.query(`SET LOCAL app.current_tenant = '${TENANT_B}'`);
    await client.query(`
      INSERT INTO tickets (id, tenant_id, organization_id, subject, status, priority)
      VALUES ($1, $2, $3, 'Ticket B subject', 'open', 'P3')
      ON CONFLICT DO NOTHING
    `, [TICKET_B, TENANT_B, ORG_B]);

    await client.query(`
      INSERT INTO ticket_comments (id, tenant_id, ticket_id, organization_id, body)
      VALUES ($1, $2, $3, $4, 'Comment B')
      ON CONFLICT DO NOTHING
    `, [COMMENT_B, TENANT_B, TICKET_B, ORG_B]);

    await client.query(`
      INSERT INTO ticket_attachments (id, tenant_id, ticket_id, organization_id, filename, mime_type, s3_key)
      VALUES ($1, $2, $3, $4, 'file-b.pdf', 'application/pdf', 's3/b/file-b.pdf')
      ON CONFLICT DO NOTHING
    `, [ATTACH_B, TENANT_B, TICKET_B, ORG_B]);

    await client.query(`
      INSERT INTO tags (id, tenant_id, name)
      VALUES ($1, $2, 'tag-b')
      ON CONFLICT DO NOTHING
    `, [TAG_B, TENANT_B]);

    await client.query(`
      INSERT INTO ticket_tags (tenant_id, ticket_id, tag_id)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
    `, [TENANT_B, TICKET_B, TAG_B]);

    await client.query(`
      INSERT INTO assignment_groups (id, tenant_id, name)
      VALUES ($1, $2, 'Group B')
      ON CONFLICT DO NOTHING
    `, [GROUP_B, TENANT_B]);

    await client.query(`
      INSERT INTO assignment_group_members (id, tenant_id, group_id, user_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
    `, [MEMBER_B, TENANT_B, GROUP_B, TENANT_B]);  // user_id reuses TENANT_B uuid for fixture

    await client.query(`
      INSERT INTO ticket_status_history (id, tenant_id, ticket_id, to_status)
      VALUES ($1, $2, $3, 'open')
      ON CONFLICT DO NOTHING
    `, [HISTORY_B, TENANT_B, TICKET_B]);

    await client.query(`
      INSERT INTO tenant_sequences (tenant_id, sequence_name, last_value)
      VALUES ($1, 'tickets', 1)
      ON CONFLICT DO NOTHING
    `, [TENANT_B]);

    // Switch to Tenant A context for assertions.
    await setTenant(client, TENANT_A);
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  // ── tickets ───────────────────────────────────────────────────────────────

  it('tickets: Tenant A row is visible', async () => {
    const { rows } = await client.query(`SELECT id FROM tickets WHERE id = $1`, [TICKET_A]);
    expect(rows).toHaveLength(1);
  });

  it('tickets: Tenant B row is invisible when tenant = A', async () => {
    const { rows } = await client.query(`SELECT id FROM tickets WHERE id = $1`, [TICKET_B]);
    expect(rows).toHaveLength(0);
  });

  it('tickets: unscoped SELECT returns no Tenant B rows', async () => {
    const { rows } = await client.query<{ tenant_id: string }>(`SELECT tenant_id FROM tickets`);
    expect(rows.filter((r) => r.tenant_id === TENANT_B)).toHaveLength(0);
  });

  // ── ticket_comments ───────────────────────────────────────────────────────

  it('ticket_comments: Tenant B row invisible when tenant = A', async () => {
    const { rows } = await client.query(`SELECT id FROM ticket_comments WHERE id = $1`, [COMMENT_B]);
    expect(rows).toHaveLength(0);
  });

  // ── ticket_attachments ────────────────────────────────────────────────────

  it('ticket_attachments: Tenant B row invisible when tenant = A', async () => {
    const { rows } = await client.query(`SELECT id FROM ticket_attachments WHERE id = $1`, [ATTACH_B]);
    expect(rows).toHaveLength(0);
  });

  // ── tags ─────────────────────────────────────────────────────────────────

  it('tags: Tenant B row invisible when tenant = A', async () => {
    const { rows } = await client.query(`SELECT id FROM tags WHERE id = $1`, [TAG_B]);
    expect(rows).toHaveLength(0);
  });

  // ── ticket_tags ───────────────────────────────────────────────────────────

  it('ticket_tags: Tenant B row invisible when tenant = A', async () => {
    const { rows } = await client.query(
      `SELECT tag_id FROM ticket_tags WHERE tenant_id = $1`,
      [TENANT_B],
    );
    expect(rows).toHaveLength(0);
  });

  // ── assignment_groups ─────────────────────────────────────────────────────

  it('assignment_groups: Tenant B row invisible when tenant = A', async () => {
    const { rows } = await client.query(`SELECT id FROM assignment_groups WHERE id = $1`, [GROUP_B]);
    expect(rows).toHaveLength(0);
  });

  // ── assignment_group_members ──────────────────────────────────────────────

  it('assignment_group_members: Tenant B row invisible when tenant = A', async () => {
    const { rows } = await client.query(`SELECT id FROM assignment_group_members WHERE id = $1`, [MEMBER_B]);
    expect(rows).toHaveLength(0);
  });

  // ── ticket_status_history ─────────────────────────────────────────────────

  it('ticket_status_history: Tenant B row invisible when tenant = A', async () => {
    const { rows } = await client.query(`SELECT id FROM ticket_status_history WHERE id = $1`, [HISTORY_B]);
    expect(rows).toHaveLength(0);
  });

  // ── tenant_sequences ──────────────────────────────────────────────────────

  it('tenant_sequences: Tenant B row invisible when tenant = A', async () => {
    const { rows } = await client.query(
      `SELECT last_value FROM tenant_sequences WHERE tenant_id = $1 AND sequence_name = 'tickets'`,
      [TENANT_B],
    );
    expect(rows).toHaveLength(0);
  });

  // ── app.current_tenant unset → error, not all-rows ────────────────────────

  it('tickets: unset app.current_tenant raises error (fail-closed)', async () => {
    await client.query(`SET LOCAL app.current_tenant = ''`);
    await expect(
      client.query(`SELECT id FROM tickets LIMIT 1`),
    ).rejects.toThrow();
  });
});
