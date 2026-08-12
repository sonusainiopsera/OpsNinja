/**
 * db-role-privileges.spec.ts — Schema and role introspection for RLS invariants.
 *
 * Assertions (WO-098 AC7):
 *   1. The application database role has neither SUPERUSER nor BYPASSRLS.
 *   2. FORCE ROW LEVEL SECURITY is enabled on every table that carries a
 *      tenant_id column — enumerated dynamically from information_schema so
 *      newly added tables are automatically covered.
 *   3. RLS is ENABLED on every tenant-scoped table (not just defined but active).
 *   4. Every tenant-scoped table has at least one RLS policy that references
 *      current_setting('app.current_tenant') in its USING expression.
 *
 * Guarded by DATABASE_URL — skipped in CI without a live Postgres container.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SKIP = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP ? describe.skip : describe;

const APP_ROLE = process.env['DB_APP_ROLE'] ?? 'opsninja_app';

let pool: import('pg').Pool | undefined;

async function query<T = unknown>(
  sql: string,
  params: unknown[] = [],
): Promise<import('pg').QueryResult<T extends Record<string, unknown> ? T : Record<string, unknown>>> {
  if (!pool) throw new Error('Pool not initialised');
  return pool.query(sql, params) as never;
}

maybeDescribe('DB role privileges and RLS enforcement (requires DATABASE_URL)', () => {
  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 2 });
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await pool?.end();
  });

  // ── 1. Application role privileges ────────────────────────────────────────

  describe('Application role privilege assertions', () => {
    it('application role is not SUPERUSER', async () => {
      const result = await query<{ rolname: string; rolsuper: boolean }>(
        `SELECT rolname, rolsuper FROM pg_roles WHERE rolname = $1`,
        [APP_ROLE],
      );
      expect(result.rows.length).toBeGreaterThan(0);
      for (const row of result.rows) {
        expect(row.rolsuper).toBe(false);
      }
    });

    it('application role does not have BYPASSRLS', async () => {
      const result = await query<{ rolname: string; rolbypassrls: boolean }>(
        `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = $1`,
        [APP_ROLE],
      );
      expect(result.rows.length).toBeGreaterThan(0);
      for (const row of result.rows) {
        expect(row.rolbypassrls).toBe(false);
      }
    });

    it('application role does not have CREATEROLE', async () => {
      const result = await query<{ rolcreaterole: boolean }>(
        `SELECT rolcreaterole FROM pg_roles WHERE rolname = $1`,
        [APP_ROLE],
      );
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0]?.rolcreaterole).toBe(false);
    });
  });

  // ── 2. Enumerate tenant-scoped tables dynamically ─────────────────────────

  describe('All tenant_id tables have RLS enabled and forced', () => {
    it('discovers tenant-scoped tables and asserts RLS enabled on each', async () => {
      // Enumerate tables with a tenant_id column in the public schema
      const tableResult = await query<{ table_name: string }>(
        `SELECT DISTINCT c.table_name
         FROM information_schema.columns c
         WHERE c.column_name = 'tenant_id'
           AND c.table_schema = 'public'
           AND c.table_name NOT LIKE 'pg_%'
         ORDER BY c.table_name`,
      );
      const tables = tableResult.rows.map((r) => r.table_name);
      expect(tables.length).toBeGreaterThan(0);

      // For each tenant-scoped table, assert RLS is enabled
      const rlsResult = await query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND c.relname = ANY($1)`,
        [tables],
      );

      const rlsMap = new Map(rlsResult.rows.map((r) => [r.relname, r]));

      const rlsDisabled: string[] = [];
      const forceDisabled: string[] = [];

      for (const table of tables) {
        const row = rlsMap.get(table);
        if (!row) continue; // view or partitioned — skip
        if (!row.relrowsecurity) rlsDisabled.push(table);
        if (!row.relforcerowsecurity) forceDisabled.push(table);
      }

      expect(
        rlsDisabled,
        `RLS not enabled on tables: ${rlsDisabled.join(', ')}`,
      ).toEqual([]);

      expect(
        forceDisabled,
        `FORCE ROW LEVEL SECURITY not set on tables: ${forceDisabled.join(', ')}`,
      ).toEqual([]);
    });
  });

  // ── 3. RLS policies reference app.current_tenant ──────────────────────────

  describe('RLS policies reference app.current_tenant', () => {
    it('every tenant-scoped table has a policy referencing app.current_tenant', async () => {
      const tableResult = await query<{ table_name: string }>(
        `SELECT DISTINCT c.table_name
         FROM information_schema.columns c
         WHERE c.column_name = 'tenant_id'
           AND c.table_schema = 'public'
           AND c.table_name NOT LIKE 'pg_%'`,
      );
      const tables = tableResult.rows.map((r) => r.table_name);

      const policyResult = await query<{
        tablename: string;
        policyname: string;
        qual: string;
      }>(
        `SELECT p.tablename, p.policyname, p.qual
         FROM pg_policies p
         WHERE p.schemaname = 'public'
           AND p.tablename = ANY($1)`,
        [tables],
      );

      // Build a map of table → policies
      const policyMap = new Map<string, string[]>();
      for (const p of policyResult.rows) {
        const existing = policyMap.get(p.tablename) ?? [];
        existing.push(p.qual ?? '');
        policyMap.set(p.tablename, existing);
      }

      const tablesWithoutPolicy: string[] = [];
      const tablesWithoutTenantRef: string[] = [];

      for (const table of tables) {
        const policies = policyMap.get(table);
        if (!policies || policies.length === 0) {
          tablesWithoutPolicy.push(table);
          continue;
        }
        // At least one policy must reference current_setting('app.current_tenant')
        const hasTenantRef = policies.some(
          (p) =>
            p.includes("current_setting('app.current_tenant')") ||
            p.includes('app.current_tenant'),
        );
        if (!hasTenantRef) {
          tablesWithoutTenantRef.push(table);
        }
      }

      expect(
        tablesWithoutPolicy,
        `Tables with no RLS policy: ${tablesWithoutPolicy.join(', ')}`,
      ).toEqual([]);

      expect(
        tablesWithoutTenantRef,
        `Tables whose RLS policies do not reference app.current_tenant: ${tablesWithoutTenantRef.join(', ')}`,
      ).toEqual([]);
    });
  });

  // ── 4. Spot-check critical tables explicitly ───────────────────────────────

  describe('Critical table RLS spot-check', () => {
    const CRITICAL_TABLES = [
      'tickets',
      'organizations',
      'contacts',
      'comments',
      'audit_events',
      'outbox_events',
    ];

    for (const table of CRITICAL_TABLES) {
      it(`${table} has RLS enabled and forced`, async () => {
        const result = await query<{
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
        }>(
          `SELECT c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = $1`,
          [table],
        );
        if (result.rows.length === 0) return; // table not present in this schema version
        expect(result.rows[0]?.relrowsecurity).toBe(true);
        expect(result.rows[0]?.relforcerowsecurity).toBe(true);
      });
    }
  });

  // ── 5. Coverage report ────────────────────────────────────────────────────

  describe('Coverage report', () => {
    it('emits machine-readable verdict for all tenant-scoped tables', async () => {
      const tableResult = await query<{ table_name: string }>(
        `SELECT DISTINCT c.table_name
         FROM information_schema.columns c
         WHERE c.column_name = 'tenant_id'
           AND c.table_schema = 'public'
           AND c.table_name NOT LIKE 'pg_%'
         ORDER BY c.table_name`,
      );

      const rlsResult = await query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'`,
      );

      const rlsMap = new Map(rlsResult.rows.map((r) => [r.relname, r]));

      const verdicts = tableResult.rows.map((r) => {
        const rlsRow = rlsMap.get(r.table_name);
        return {
          table: r.table_name,
          rlsEnabled: rlsRow?.relrowsecurity ?? false,
          rlsForced: rlsRow?.relforcerowsecurity ?? false,
          verdict:
            rlsRow?.relrowsecurity && rlsRow?.relforcerowsecurity ? 'PASS' : 'FAIL',
        };
      });

      // Log verdicts for CI artifact collection
      console.info(
        '[WO-098 DB-ROLE-COVERAGE]',
        JSON.stringify(verdicts, null, 2),
      );

      const failed = verdicts.filter((v) => v.verdict === 'FAIL');
      expect(
        failed.map((v) => v.table),
        'Tables with RLS violations',
      ).toEqual([]);
    });
  });
});
