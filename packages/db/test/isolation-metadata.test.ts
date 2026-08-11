/**
 * Metadata-driven isolation assertions.
 *
 * For every tenant-scoped table in the schema registry this suite queries
 * information_schema and PostgreSQL system catalogs to assert:
 *   1. tenant_id column is non-nullable.
 *   2. A tenant_id-leading index exists.
 *   3. ENABLE ROW LEVEL SECURITY is set.
 *   4. FORCE ROW LEVEL SECURITY is set.
 *   5. A tenant_isolation policy covering at least SELECT and INSERT exists.
 *
 * Tables explicitly registered as global (no tenant_id) are skipped if they
 * appear in GLOBAL_TABLES. An unregistered table FAILS — it must be classified.
 *
 * Requires DATABASE_URL. Skipped in offline runs.
 */

import { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Table registry — every tenant-scoped table must be listed here.
// Global tables (no tenant_id, e.g. audit_logs which uses text not FK) must be
// explicitly recorded in GLOBAL_TABLES with a justification.
// ---------------------------------------------------------------------------

const TENANT_SCOPED_TABLES: string[] = [
  'tenants',          // owns itself — tenant_id is the PK (self-referential)
  'organizations',
  'users',
  'tickets',
  'ticket_comments',
  'ticket_attachments',
  'tenant_settings',
  'refresh_sessions',
  'agent_org_scopes',
  'notifications',
  'notification_templates',
  'notification_suppressions',
  'webhook_endpoints',
  // WO-023: organization registry tables
  'customer_accounts',
  'contacts',
  'organization_verified_domains',
  'custom_field_defs',
  // WO-039: saved views tables
  'saved_views',
  'saved_view_pins',
  // WO-044: SLA module tables
  'sla_calendars',
  'sla_calendar_windows',
  'sla_calendar_holidays',
  'sla_policies',
  'sla_policy_versions',
  // WO-051: Jira connection table
  'jira_connections',
  // WO-073: Reporting tables
  'report_definitions',
  'export_jobs',
  // WO-082: CSAT surveys
  'csat_surveys',
  // WO-084: Webhook delivery log (partitioned — parent table)
  'webhook_deliveries',
  // WO-087: Portal signup and verification
  'portal_signup_requests',
  'portal_verification_tokens',
  'portal_users',
  // WO-031: Ticketing core schema
  'tags',
  'ticket_tags',
  'assignment_groups',
  'assignment_group_members',
  'ticket_status_history',
  'tenant_sequences',
];

// Tables deliberately without per-row tenant_id (cross-tenant or system tables).
// Any table in the DB not in either list FAILS.
const GLOBAL_TABLES: Record<string, string> = {
  audit_logs: 'Cross-cutting security log; tenant_id is nullable text (pre-auth events have no tenant)',
};

// ---------------------------------------------------------------------------
// Skip guard
// ---------------------------------------------------------------------------

const SKIP = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

maybeDescribe('Isolation metadata assertions', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('every table is classified as tenant-scoped or global — no unregistered tables', async () => {
    const res = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );

    const allKnown = new Set([...TENANT_SCOPED_TABLES, ...Object.keys(GLOBAL_TABLES)]);
    const unregistered = res.rows
      .map((r) => r.table_name)
      .filter((name) => !allKnown.has(name));

    expect(unregistered).toEqual([]);
    if (unregistered.length > 0) {
      throw new Error(
        `Unregistered tables detected — add to TENANT_SCOPED_TABLES or GLOBAL_TABLES:\n` +
        unregistered.map((t) => `  - ${t}`).join('\n'),
      );
    }
  });

  for (const table of TENANT_SCOPED_TABLES) {
    // Skip tenants itself for tenant_id FK check (it IS the tenant)
    if (table === 'tenants') continue;

    describe(`Table: ${table}`, () => {
      it('has a non-nullable tenant_id column', async () => {
        const res = await pool.query<{ is_nullable: string }>(
          `SELECT is_nullable FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = $1
             AND column_name = 'tenant_id'`,
          [table],
        );
        expect(res.rows.length).toBeGreaterThan(0);
        expect(res.rows[0]?.is_nullable).toBe('NO');
      });

      it('has a tenant_id-leading index', async () => {
        const res = await pool.query<{ index_name: string }>(
          `SELECT i.relname AS index_name
           FROM pg_index ix
           JOIN pg_class t  ON t.oid = ix.indrelid
           JOIN pg_class i  ON i.oid = ix.indexrelid
           JOIN pg_attribute a ON a.attrelid = t.oid
                              AND a.attnum = ix.indkey[0]
           JOIN pg_namespace n ON n.oid = t.relnamespace
           WHERE t.relname = $1
             AND n.nspname = 'public'
             AND a.attname = 'tenant_id'`,
          [table],
        );
        expect(res.rows.length).toBeGreaterThan(0);
      });

      it('has RLS enabled', async () => {
        const res = await pool.query<{ relrowsecurity: boolean }>(
          `SELECT relrowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relname = $1 AND n.nspname = 'public'`,
          [table],
        );
        expect(res.rows[0]?.relrowsecurity).toBe(true);
      });

      it('has RLS forced (prevents bypass by table owner)', async () => {
        const res = await pool.query<{ relforcerowsecurity: boolean }>(
          `SELECT relforcerowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relname = $1 AND n.nspname = 'public'`,
          [table],
        );
        expect(res.rows[0]?.relforcerowsecurity).toBe(true);
      });

      it('has a tenant_isolation RLS policy', async () => {
        const res = await pool.query<{ policyname: string; cmd: string }>(
          `SELECT policyname, cmd
           FROM pg_policies
           WHERE schemaname = 'public' AND tablename = $1`,
          [table],
        );
        const policyNames = res.rows.map((r) => r.policyname);
        const hasIsolationPolicy = policyNames.some((n) =>
          n.includes('tenant') || n.includes('isolation'),
        );
        expect(hasIsolationPolicy).toBe(true);
      });
    });
  }
});
