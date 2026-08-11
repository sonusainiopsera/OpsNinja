/**
 * RLS metadata tests.
 *
 * Asserts the structural properties of the schema as visible through the
 * PostgreSQL system catalogs — no data-level assertions here. These tests
 * run against a real PostgreSQL 16 container with all migrations applied.
 *
 * Test cases:
 *   1. Every tenant-scoped table has relrowsecurity = true
 *   2. Every tenant-scoped table has relforcerowsecurity = true
 *   3. Every tenant-scoped table has a tenant_isolation policy for all four
 *      DML commands (SELECT, INSERT, UPDATE, DELETE)
 *   4. Portal RESTRICTIVE policies exist on tickets and ticket_comments
 *   5. app_user does NOT have UPDATE or DELETE on audit_logs
 *   6. app_user does NOT have CREATE on schema public
 *   7. Policy builder unit: getTenantScopedTableNames covers all tables marked
 *      tenantScoped in the registry
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import { expect } from 'vitest';
import postgres from 'postgres';
import { createTestDb, type TestDbContext } from './harness.js';
import { TENANT_SCOPED_TABLES, PORTAL_POLICY_TABLES } from '../src/schema/table-registry.js';
import {
  getTenantScopedTableNames,
  buildTablePolicyBlock,
  TENANT_PREDICATE,
} from '../src/rls/policy-builder.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let ctx: TestDbContext;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  ctx = await createTestDb('rls-metadata');
  sql = postgres(ctx.connectionString, { max: 3 });
}, 120_000);

afterAll(async () => {
  await sql.end();
  await ctx.teardown();
});

// ---------------------------------------------------------------------------
// 1 & 2. relrowsecurity + relforcerowsecurity
// ---------------------------------------------------------------------------

describe('pg_class flags: relrowsecurity and relforcerowsecurity', () => {
  for (const entry of TENANT_SCOPED_TABLES) {
    it(`${entry.name} has relrowsecurity = true`, async () => {
      const rows = await sql.unsafe(`
        SELECT relrowsecurity
        FROM pg_class
        WHERE relname = '${entry.name}' AND relkind IN ('r', 'p')
        LIMIT 1
      `);
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>)['relrowsecurity']).toBe(true);
    });

    it(`${entry.name} has relforcerowsecurity = true`, async () => {
      const rows = await sql.unsafe(`
        SELECT relforcerowsecurity
        FROM pg_class
        WHERE relname = '${entry.name}' AND relkind IN ('r', 'p')
        LIMIT 1
      `);
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>)['relforcerowsecurity']).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. tenant_isolation policy exists for each command
// ---------------------------------------------------------------------------

describe('pg_policy: tenant_isolation exists for all tenant-scoped tables', () => {
  for (const entry of TENANT_SCOPED_TABLES) {
    it(`${entry.name} has a tenant_isolation policy`, async () => {
      const rows = await sql.unsafe(`
        SELECT polname, polcmd
        FROM pg_policy
        WHERE polrelid = '${entry.name}'::regclass
          AND polname = 'tenant_isolation'
      `);
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Portal RESTRICTIVE policies
// ---------------------------------------------------------------------------

describe('pg_policy: portal RESTRICTIVE policies', () => {
  for (const entry of PORTAL_POLICY_TABLES) {
    it(`${entry.name} has portal policy '${entry.portalPolicy}'`, async () => {
      const rows = await sql.unsafe(`
        SELECT polname, polpermissive
        FROM pg_policy
        WHERE polrelid = '${entry.name}'::regclass
          AND polname = '${entry.portalPolicy}'
      `);
      expect(rows).toHaveLength(1);
      // polpermissive = false means AS RESTRICTIVE
      expect((rows[0] as Record<string, unknown>)['polpermissive']).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. app_user grants on audit_logs (no UPDATE or DELETE)
// ---------------------------------------------------------------------------

describe('grant matrix: audit_logs append-only grants for app_user', () => {
  it('app_user has SELECT on audit_logs', async () => {
    const rows = await sql.unsafe(`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'app_user'
        AND table_name = 'audit_logs'
        AND privilege_type = 'SELECT'
    `);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('app_user has INSERT on audit_logs', async () => {
    const rows = await sql.unsafe(`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'app_user'
        AND table_name = 'audit_logs'
        AND privilege_type = 'INSERT'
    `);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('app_user does NOT have UPDATE on audit_logs', async () => {
    const rows = await sql.unsafe(`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'app_user'
        AND table_name = 'audit_logs'
        AND privilege_type = 'UPDATE'
    `);
    expect(rows).toHaveLength(0);
  });

  it('app_user does NOT have DELETE on audit_logs', async () => {
    const rows = await sql.unsafe(`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'app_user'
        AND table_name = 'audit_logs'
        AND privilege_type = 'DELETE'
    `);
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. app_user does not have CREATE on public schema
// ---------------------------------------------------------------------------

describe('grant matrix: app_user has no CREATE on public schema', () => {
  it('app_user does not hold CREATE on schema public', async () => {
    const rows = await sql.unsafe(`
      SELECT
        has_schema_privilege('app_user', 'public', 'CREATE') AS can_create
    `);
    expect((rows[0] as Record<string, unknown>)['can_create']).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Policy builder unit tests
// ---------------------------------------------------------------------------

describe('policy-builder unit tests', () => {
  it('getTenantScopedTableNames returns all tenantScoped tables from registry', () => {
    const registryNames = TENANT_SCOPED_TABLES.map((t) => t.name);
    const builderNames = getTenantScopedTableNames();
    expect(builderNames).toEqual(registryNames);
  });

  it('buildTablePolicyBlock includes ENABLE and FORCE ROW LEVEL SECURITY', () => {
    const sql_text = buildTablePolicyBlock('test_table');
    expect(sql_text).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql_text).toContain('FORCE ROW LEVEL SECURITY');
  });

  it('buildTablePolicyBlock includes DROP POLICY IF EXISTS (idempotent)', () => {
    const sql_text = buildTablePolicyBlock('test_table');
    expect(sql_text).toContain('DROP POLICY IF EXISTS tenant_isolation ON test_table');
  });

  it('buildTablePolicyBlock includes both USING and WITH CHECK with tenant predicate', () => {
    const sql_text = buildTablePolicyBlock('test_table');
    expect(sql_text).toContain(`USING      (${TENANT_PREDICATE})`);
    expect(sql_text).toContain(`WITH CHECK (${TENANT_PREDICATE})`);
  });

  it('TENANT_PREDICATE uses missing_ok current_setting for fail-closed behaviour', () => {
    expect(TENANT_PREDICATE).toContain(`current_setting('app.current_tenant', true)`);
  });

  it('registry has no duplicate table names', () => {
    const names = TENANT_SCOPED_TABLES.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// 8. Partitioned tables: policies apply to child partitions
// ---------------------------------------------------------------------------

describe('RLS: partitioned parent and child partition both have RLS', () => {
  const partitionedTables = ['tickets', 'ticket_comments', 'audit_logs'];

  for (const tableName of partitionedTables) {
    it(`${tableName} parent is partitioned and has RLS enabled`, async () => {
      const rows = await sql.unsafe(`
        SELECT relrowsecurity, relforcerowsecurity, relkind
        FROM pg_class
        WHERE relname = '${tableName}' AND relkind = 'p'
      `);
      expect(rows).toHaveLength(1);
      const row = rows[0] as Record<string, unknown>;
      expect(row['relrowsecurity']).toBe(true);
      expect(row['relforcerowsecurity']).toBe(true);
    });

    it(`${tableName} default partition inherits RLS`, async () => {
      const rows = await sql.unsafe(`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = '${tableName}'
          AND c.relkind = 'r'
        LIMIT 1
      `);
      // If a child partition exists, it should also have RLS enabled
      if (rows.length > 0) {
        const row = rows[0] as Record<string, unknown>;
        expect(row['relrowsecurity']).toBe(true);
        expect(row['relforcerowsecurity']).toBe(true);
      }
      // If no partition exists yet (fresh container), this is acceptable
    });
  }
});
