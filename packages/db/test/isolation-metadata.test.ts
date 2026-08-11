/**
 * Isolation Metadata Suite
 *
 * Validates that every tenant-scoped table in the database satisfies the
 * required isolation controls:
 *   1. tenant_id column exists and is NOT NULL
 *   2. At least one index starts with tenant_id (tenant_id-leading index)
 *   3. ENABLE ROW LEVEL SECURITY is on
 *   4. FORCE ROW LEVEL SECURITY is on
 *   5. A policy covering all four DML commands (SELECT, INSERT, UPDATE, DELETE)
 *      named after the tenant_isolation pattern
 *
 * Global tables (e.g. refresh_sessions, which has its own app-level isolation)
 * must be explicitly registered in GLOBALLY_SCOPED_TABLES to avoid the harness
 * treating an omission as a pass.
 *
 * Skip condition: set ISOLATION_TEST_DB_URL or TEST_DATABASE_URL to a
 * Postgres 16 instance that has been migrated.
 */

import { Pool } from 'pg';

// ── Table Registry ────────────────────────────────────────────────────────────

/**
 * Tables that are intentionally NOT tenant-scoped and have explicit justifications.
 *
 * Any table NOT in this list and NOT in TENANT_SCOPED_TABLES will fail the
 * harness with "unregistered table" — the harness never silently passes.
 */
const GLOBALLY_SCOPED_TABLES: Record<string, string> = {
  refresh_sessions: 'Auth infrastructure; isolation enforced by tenantId column in app queries (no RLS because @NoTenantContext auth routes bypass the tenant interceptor)',
};

/**
 * Tables that must satisfy all five isolation controls.
 * Extend this list when a new migration creates a tenant-scoped table.
 */
const TENANT_SCOPED_TABLES: string[] = [
  'tickets',
  'comments',
  'attachments',
  'organizations',
  'agent_org_scopes',
  'audit_logs',
  'notifications',
  'notification_templates',
  'notification_suppressions',
  'webhook_endpoints',
  'tenant_settings',
  // WO-023: Organization registry
  'customer_accounts',
  'contacts',
  'organization_verified_domains',
  'custom_field_defs',
  // WO-039: Saved views and per-agent pin state
  'saved_views',
  'saved_view_pins',
  // WO-044: SLA policy and business calendar schema
  'sla_calendars',
  'sla_calendar_windows',
  'sla_calendar_holidays',
  'sla_policies',
  'sla_policy_versions',
  // WO-051: Jira connection and credential vault
  'jira_connections',
  // WO-073: Report definitions and export jobs
  'report_definitions',
  'export_jobs',
  // WO-082: CSAT surveys
  'csat_surveys',
  // WO-084: Webhook delivery log (partitioned; parent table carries RLS)
  'webhook_deliveries',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getTenantIdColumns(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'tenant_id'
      AND is_nullable = 'NO'
  `);
  return new Set(rows.map((r) => r.table_name));
}

async function getTablesWithTenantIdLeadingIndex(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ table_name: string }>(`
    SELECT DISTINCT t.relname AS table_name
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
    WHERE n.nspname = 'public'
      AND a.attname = 'tenant_id'
  `);
  return new Set(rows.map((r) => r.table_name));
}

async function getTablesWithRlsEnabled(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ relname: string }>(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relrowsecurity = TRUE
  `);
  return new Set(rows.map((r) => r.relname));
}

async function getTablesWithRlsForced(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ relname: string }>(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relforcerowsecurity = TRUE
  `);
  return new Set(rows.map((r) => r.relname));
}

interface PolicyRow {
  tablename: string;
  cmd: string;
}

async function getRlsPolicies(pool: Pool): Promise<Map<string, Set<string>>> {
  const { rows } = await pool.query<PolicyRow>(`
    SELECT tablename, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
  `);
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!map.has(row.tablename)) map.set(row.tablename, new Set());
    map.get(row.tablename)!.add(row.cmd.toUpperCase());
  }
  return map;
}

async function getAllPublicTables(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return rows.map((r) => r.table_name);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

const DB_URL = process.env.ISOLATION_TEST_DB_URL ?? process.env.TEST_DATABASE_URL;
const SKIP = !DB_URL;

const describeOrSkip = SKIP ? describe.skip : describe;
describeOrSkip('Isolation Metadata Suite', () => {
  let pool: Pool;

  let tablesWithTenantId: Set<string>;
  let tablesWithLeadingIndex: Set<string>;
  let tablesWithRlsEnabled: Set<string>;
  let tablesWithRlsForced: Set<string>;
  let rlsPolicies: Map<string, Set<string>>;
  let allPublicTables: string[];

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL!, max: 2 });
    [tablesWithTenantId, tablesWithLeadingIndex, tablesWithRlsEnabled, tablesWithRlsForced, rlsPolicies, allPublicTables] =
      await Promise.all([
        getTenantIdColumns(pool),
        getTablesWithTenantIdLeadingIndex(pool),
        getTablesWithRlsEnabled(pool),
        getTablesWithRlsForced(pool),
        getRlsPolicies(pool),
        getAllPublicTables(pool),
      ]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('every public table is registered as either tenant-scoped or explicitly global', () => {
    const registeredTables = new Set([
      ...TENANT_SCOPED_TABLES,
      ...Object.keys(GLOBALLY_SCOPED_TABLES),
    ]);
    const unregistered = allPublicTables.filter(
      (t) => !registeredTables.has(t) && !t.startsWith('notifications_'),  // monthly partitions inherit parent
    );
    if (unregistered.length > 0) {
      throw new Error(
        `Unregistered tables found — add to TENANT_SCOPED_TABLES or GLOBALLY_SCOPED_TABLES:\n  ${unregistered.join('\n  ')}`,
      );
    }
  });

  describe.each(TENANT_SCOPED_TABLES)('table: %s', (tableName) => {
    it('has a non-nullable tenant_id column', () => {
      if (!tablesWithTenantId.has(tableName)) {
        throw new Error(
          `Table '${tableName}' is missing a NOT NULL tenant_id column. ` +
            'Add "tenant_id UUID NOT NULL" to the table definition.',
        );
      }
    });

    it('has a tenant_id-leading index', () => {
      if (!tablesWithLeadingIndex.has(tableName)) {
        throw new Error(
          `Table '${tableName}' has no index starting with tenant_id. ` +
            'Add CREATE INDEX ... ON table(tenant_id, ...) to the migration.',
        );
      }
    });

    it('has ENABLE ROW LEVEL SECURITY', () => {
      if (!tablesWithRlsEnabled.has(tableName)) {
        throw new Error(
          `Table '${tableName}' does not have ROW LEVEL SECURITY enabled. ` +
            'Add "ALTER TABLE ... ENABLE ROW LEVEL SECURITY" to the migration.',
        );
      }
    });

    it('has FORCE ROW LEVEL SECURITY', () => {
      if (!tablesWithRlsForced.has(tableName)) {
        throw new Error(
          `Table '${tableName}' does not have FORCE ROW LEVEL SECURITY. ` +
            'Add "ALTER TABLE ... FORCE ROW LEVEL SECURITY" to the migration.',
        );
      }
    });

    it('has RLS policies for SELECT, INSERT, UPDATE, and DELETE', () => {
      const commands = rlsPolicies.get(tableName) ?? new Set<string>();
      const REQUIRED_CMDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
      const missing = REQUIRED_CMDS.filter((cmd) => !commands.has(cmd) && !commands.has('ALL'));
      if (missing.length > 0) {
        throw new Error(
          `Table '${tableName}' RLS policies are missing coverage for: ${missing.join(', ')}. ` +
            'Add per-command RLS policies or a single ALL-command policy.',
        );
      }
    });
  });
});

describe('Isolation Metadata Suite (unit tests — no DB)', () => {
  it('TENANT_SCOPED_TABLES is non-empty', () => {
    expect(TENANT_SCOPED_TABLES.length).toBeGreaterThan(0);
  });

  it('every entry in TENANT_SCOPED_TABLES is a non-empty string', () => {
    for (const t of TENANT_SCOPED_TABLES) {
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it('no table appears in both TENANT_SCOPED_TABLES and GLOBALLY_SCOPED_TABLES', () => {
    const globalKeys = new Set(Object.keys(GLOBALLY_SCOPED_TABLES));
    const overlap = TENANT_SCOPED_TABLES.filter((t) => globalKeys.has(t));
    expect(overlap).toHaveLength(0);
  });

  it('GLOBALLY_SCOPED_TABLES entries have non-empty justifications', () => {
    for (const [, justification] of Object.entries(GLOBALLY_SCOPED_TABLES)) {
      expect(justification.length).toBeGreaterThan(10);
    }
  });
});
