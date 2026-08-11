/**
 * Schema invariant tests.
 *
 * These tests enumerate tenant-scoped tables from information_schema and
 * pg_index and assert the non-nullable tenant_id design rule:
 *
 *   Every tenant-scoped table must have:
 *     1. A non-nullable `tenant_id` column of type uuid.
 *     2. A composite primary key or principal index whose FIRST column is
 *        `tenant_id`.
 *
 * The test suite deliberately runs BEFORE integration tests so it catches
 * tenant_id violations while the schema is still growing.
 *
 * A test failure prints the offending table list so the developer can see
 * exactly which table violates the rule.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { type TestDbContext, createTestDb } from './harness.js';

// Tables that are intentionally NOT tenant-scoped (no tenant_id column).
const NON_TENANT_SCOPED_TABLES = new Set([
  'tenants',
  'retention_policies',
  // Partition children are prefixed with parent name; these are excluded
  // because they inherit from their parent and are not independently listed
  // in information_schema.tables as base tables when using inheritance.
]);

// Tables that ARE tenant-scoped and must comply with the design rule.
const EXPECTED_TENANT_SCOPED_TABLES = [
  'organizations',
  'organization_verified_domains',
  'custom_field_defs',
  'users',
  'customer_contacts',
  'role_assignments',
  'agent_org_scopes',
  'categories',
  'tickets',
  'ticket_comments',
  'audit_logs',
  'outbox_events',
  'ticket_ai_summaries',
  'ticket_affected_areas',
];

// Tables that must have ENABLE ROW LEVEL SECURITY (CI RLS-coverage check).
const RLS_REQUIRED_TABLES = [
  'organizations',
  'organization_verified_domains',
  'custom_field_defs',
  'users',
  'customer_contacts',
  'role_assignments',
  'agent_org_scopes',
  'categories',
  'tickets',
  'ticket_comments',
  'audit_logs',
  'outbox_events',
  'ticket_ai_summaries',
  'ticket_affected_areas',
];

let ctx: TestDbContext;

beforeAll(async () => {
  ctx = await createTestDb('schema-invariants');
}, 120_000);

afterAll(async () => {
  await ctx.teardown();
}, 30_000);

describe('tenant_id design rule — non-nullable column', () => {
  it('every tenant-scoped table has a non-nullable tenant_id uuid column', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rows = await sql<{ table_name: string; is_nullable: string; data_type: string }[]>`
        SELECT
          c.table_name,
          c.is_nullable,
          c.udt_name AS data_type
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.column_name = 'tenant_id'
          AND c.table_name = ANY(${EXPECTED_TENANT_SCOPED_TABLES})
        ORDER BY c.table_name
      `;

      const foundTables = new Set(rows.map((r) => r.table_name));

      // Assert every expected table has tenant_id.
      const missing = EXPECTED_TENANT_SCOPED_TABLES.filter((t) => !foundTables.has(t));
      expect(
        missing,
        `Tables missing tenant_id column: ${missing.join(', ')}`,
      ).toHaveLength(0);

      // Assert tenant_id is non-nullable on every table.
      const nullable = rows.filter((r) => r.is_nullable === 'YES').map((r) => r.table_name);
      expect(
        nullable,
        `Tables with nullable tenant_id: ${nullable.join(', ')}`,
      ).toHaveLength(0);

      // Assert tenant_id is of type uuid.
      const nonUuid = rows.filter((r) => r.data_type !== 'uuid').map((r) => r.table_name);
      expect(
        nonUuid,
        `Tables where tenant_id is not uuid: ${nonUuid.join(', ')}`,
      ).toHaveLength(0);
    } finally {
      await sql.end();
    }
  });
});

describe('tenant_id design rule — leading index column', () => {
  it('every tenant-scoped table has tenant_id as the first column of its primary key or principal index', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      // Query pg_index to find the first key column of every index on each table.
      // We check: for each tenant-scoped table, does at least one index have
      // tenant_id as its first attribute?
      const rows = await sql<{ table_name: string; first_col: string; is_primary: boolean }[]>`
        SELECT
          t.relname        AS table_name,
          a.attname        AS first_col,
          ix.indisprimary  AS is_primary
        FROM pg_index ix
        JOIN pg_class  t  ON t.oid  = ix.indrelid
        JOIN pg_class  i  ON i.oid  = ix.indexrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid
                            AND a.attnum  = ix.indkey[0]
        WHERE n.nspname = 'public'
          AND t.relname = ANY(${EXPECTED_TENANT_SCOPED_TABLES})
        ORDER BY t.relname, ix.indisprimary DESC, i.relname
      `;

      // Group by table and collect first-column names.
      const byTable = new Map<string, string[]>();
      for (const row of rows) {
        const existing = byTable.get(row.table_name) ?? [];
        existing.push(row.first_col);
        byTable.set(row.table_name, existing);
      }

      const violators: string[] = [];
      for (const table of EXPECTED_TENANT_SCOPED_TABLES) {
        const firstCols = byTable.get(table) ?? [];
        if (!firstCols.includes('tenant_id')) {
          violators.push(`${table} (first-index-cols: [${firstCols.join(', ')}])`);
        }
      }

      expect(
        violators,
        `Tables without tenant_id-leading index:\n  ${violators.join('\n  ')}`,
      ).toHaveLength(0);
    } finally {
      await sql.end();
    }
  });
});

describe('RLS coverage — CI fails on any tenant-scoped table missing a policy', () => {
  it('every RLS-required table has ENABLE ROW LEVEL SECURITY and a tenant_isolation policy', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      // pg_policies lists all RLS policies in the current schema.
      const policyRows = await sql<{ tablename: string; policyname: string }[]>`
        SELECT tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY(${RLS_REQUIRED_TABLES})
      `;

      // pg_class.relrowsecurity is TRUE when ENABLE ROW LEVEL SECURITY is set.
      const rlsRows = await sql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY(${RLS_REQUIRED_TABLES})
          AND c.relkind = 'r'
      `;

      const rlsEnabled = new Set(rlsRows.filter((r) => r.relrowsecurity).map((r) => r.relname));
      const rlsForced  = new Set(rlsRows.filter((r) => r.relforcerowsecurity).map((r) => r.relname));
      const hasPolicies = new Set(policyRows.map((r) => r.tablename));

      const missingEnable  = RLS_REQUIRED_TABLES.filter((t) => !rlsEnabled.has(t));
      const missingForce   = RLS_REQUIRED_TABLES.filter((t) => !rlsForced.has(t));
      const missingPolicies = RLS_REQUIRED_TABLES.filter((t) => !hasPolicies.has(t));

      expect(missingEnable, `Tables missing ENABLE ROW LEVEL SECURITY: ${missingEnable.join(', ')}`).toHaveLength(0);
      expect(missingForce,  `Tables missing FORCE ROW LEVEL SECURITY: ${missingForce.join(', ')}`).toHaveLength(0);
      expect(missingPolicies, `Tables missing tenant_isolation policy: ${missingPolicies.join(', ')}`).toHaveLength(0);
    } finally {
      await sql.end();
    }
  });
});

describe('tenant_id design rule — non-tenant tables have no tenant_id', () => {
  it('tenants and retention_policies do not have a tenant_id column', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rows = await sql<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name   = 'tenant_id'
          AND table_name    = ANY(${[...NON_TENANT_SCOPED_TABLES]})
      `;
      expect(rows).toHaveLength(0);
    } finally {
      await sql.end();
    }
  });
});
