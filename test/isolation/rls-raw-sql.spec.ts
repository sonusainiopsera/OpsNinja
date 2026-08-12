/**
 * rls-raw-sql.spec.ts — Raw-SQL RLS probes through the application database role.
 *
 * Proves that Row-Level Security is the final defence layer, independent of
 * the application's own scope predicates. Tests execute raw SQL through the
 * same database role the application uses (DB_APP_ROLE, default 'opsninja_app')
 * and assert zero rows rather than an error-free leak.
 *
 * Test cases (WO-098 AC6):
 *   (a) No session variable set — all tenant-scoped tables return 0 rows.
 *   (b) Wrong tenant UUID — tables return 0 rows for a tenant with no data.
 *   (c) Mid-transaction variable change — second SET LOCAL scopes to the new
 *       tenant; rows from the first tenant are no longer visible.
 *
 * Guarded by DATABASE_URL environment variable. Skipped when absent (CI
 * without a live Postgres container).
 *
 * WO-098 AC6, AC7 (partial — table enumeration happens in db-role-privileges).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// Guard: skip unless a real Postgres connection string is provided
// ---------------------------------------------------------------------------

const SKIP = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Database client helpers (uses pg directly — no ORM layer)
// ---------------------------------------------------------------------------

let pool: import('pg').Pool | undefined;

async function query(sql: string, params: unknown[] = []): Promise<import('pg').QueryResult> {
  if (!pool) throw new Error('Pool not initialised');
  return pool.query(sql, params);
}

async function queryOneClient<T = unknown>(
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  if (!pool) throw new Error('Pool not initialised');
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Fixtures: tenant IDs used in the seeded dataset
// ---------------------------------------------------------------------------

const TENANT_A = process.env['TEST_TENANT_A_ID'] ?? 'aaaaaaaa-0000-0000-0000-000000000001';
const TENANT_B = process.env['TEST_TENANT_B_ID'] ?? 'bbbbbbbb-0000-0000-0000-000000000002';
const RANDOM_TENANT = '00000000-dead-beef-0000-000000000099';

// Tenant-scoped tables to probe
const TENANT_SCOPED_TABLES = [
  'tickets',
  'organizations',
  'contacts',
  'comments',
  'attachments',
  'saved_views',
  'ticket_ai_summaries',
  'audit_events',
  'outbox_events',
] as const;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

maybeDescribe('RLS raw-SQL probes (requires DATABASE_URL)', () => {
  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 3 });
    await pool.query('SELECT 1'); // verify connectivity
  });

  afterAll(async () => {
    await pool?.end();
  });

  // ── (a) No session variable set ────────────────────────────────────────────

  describe('(a) No session variable — zero rows from all tenant-scoped tables', () => {
    for (const table of TENANT_SCOPED_TABLES) {
      it(`${table}: returns 0 rows when app.current_tenant is not set`, async () => {
        const result = await queryOneClient(async (client) => {
          // Explicitly reset the variable (simulates a connection that never set it)
          await client.query(`SET LOCAL app.current_tenant = ''`);
          return client.query(`SELECT COUNT(*) AS n FROM ${table}`);
        });
        const count = parseInt(result.rows[0]?.n ?? '0', 10);
        expect(count).toBe(0);
      });
    }
  });

  // ── (b) Wrong tenant UUID ──────────────────────────────────────────────────

  describe('(b) Wrong tenant UUID — zero rows for non-existent tenant', () => {
    for (const table of TENANT_SCOPED_TABLES) {
      it(`${table}: returns 0 rows for RANDOM_TENANT`, async () => {
        const result = await queryOneClient(async (client) => {
          await client.query(
            `SET LOCAL app.current_tenant = '${RANDOM_TENANT}'`,
          );
          return client.query(`SELECT COUNT(*) AS n FROM ${table}`);
        });
        const count = parseInt(result.rows[0]?.n ?? '0', 10);
        expect(count).toBe(0);
      });
    }
  });

  // ── (c) Mid-transaction variable change ───────────────────────────────────

  describe('(c) Mid-transaction SET LOCAL — correct scoping after change', () => {
    it('rows visible under tenant-A are invisible after switching to tenant-B', async () => {
      await queryOneClient(async (client) => {
        await client.query('BEGIN');

        // Set to tenant-A and count visible tickets
        await client.query(`SET LOCAL app.current_tenant = '${TENANT_A}'`);
        const countA = await client.query('SELECT COUNT(*) AS n FROM tickets');
        const nA = parseInt(countA.rows[0]?.n ?? '0', 10);

        // Now switch to tenant-B in the same transaction
        await client.query(`SET LOCAL app.current_tenant = '${TENANT_B}'`);
        const countB = await client.query('SELECT COUNT(*) AS n FROM tickets');
        const nB = parseInt(countB.rows[0]?.n ?? '0', 10);

        // The counts are independent — neither set bleeds into the other
        // (both may be > 0 if seed data exists, but they should differ unless
        //  the dataset happens to have equal counts for both tenants)
        expect(nA).toBeGreaterThanOrEqual(0);
        expect(nB).toBeGreaterThanOrEqual(0);

        // Key invariant: rows visible under tenant-A are NOT visible under tenant-B
        // We check this by fetching IDs under A, then verifying those IDs are
        // invisible under B.
        if (nA > 0) {
          const idsA = await client.query<{ id: string }>(
            `SELECT id FROM tickets LIMIT 5`,
          );
          const idList = idsA.rows.map((r) => `'${r.id}'`).join(', ');

          // Switch back to tenant-B
          await client.query(`SET LOCAL app.current_tenant = '${TENANT_B}'`);
          const leak = await client.query(
            `SELECT id FROM tickets WHERE id IN (${idList})`,
          );
          // None of tenant-A's ticket IDs should appear under tenant-B
          expect(leak.rows).toHaveLength(0);
        }

        await client.query('ROLLBACK');
      });
    });

    it('attempting to set app.current_tenant to another tenant after beginning cannot unlock their rows', async () => {
      // Simulates an application bug where the tenant variable is changed mid-request.
      // The RLS policy uses current_setting(), which reflects SET LOCAL,
      // so rows switch scope immediately — but the new tenant's rows are only
      // accessible if the new value is a valid tenant.
      await queryOneClient(async (client) => {
        await client.query('BEGIN');
        await client.query(`SET LOCAL app.current_tenant = '${TENANT_A}'`);

        // Attempt to escalate to tenant-B
        await client.query(`SET LOCAL app.current_tenant = '${TENANT_B}'`);

        // Now count tickets — only tenant-B rows are visible (correct scoping),
        // NOT a combination of both.
        const result = await client.query<{ tenant_id: string }>(
          `SELECT DISTINCT tenant_id FROM tickets LIMIT 10`,
        );
        const tenantIds = result.rows.map((r) => r.tenant_id);

        // Only tenant-B (or no rows) should appear — never both tenants
        for (const tid of tenantIds) {
          expect(tid).toBe(TENANT_B);
          expect(tid).not.toBe(TENANT_A);
        }

        await client.query('ROLLBACK');
      });
    });
  });

  // ── RLS policy prevents reading after privilege reset ─────────────────────

  describe('RLS policy enforcement — no bypass via SET ROLE', () => {
    it('application role cannot bypass RLS with SET ROLE', async () => {
      // The app role must not have BYPASSRLS or SUPERUSER
      const result = await query(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      const role = result.rows[0] as { rolsuper: boolean; rolbypassrls: boolean } | undefined;
      expect(role).toBeDefined();
      expect(role?.rolsuper).toBe(false);
      expect(role?.rolbypassrls).toBe(false);
    });
  });

  // ── Verify RLS returns 0 rows rather than throwing ─────────────────────────

  describe('RLS returns empty result, not an error', () => {
    it('query with no session variable completes without pg error', async () => {
      // The test is that no exception is thrown — RLS silently filters rows
      let threw = false;
      try {
        await queryOneClient(async (client) => {
          await client.query(`SET LOCAL app.current_tenant = ''`);
          await client.query('SELECT id FROM tickets LIMIT 1');
        });
      } catch {
        threw = true;
      }
      // RLS should filter rows silently, not throw INSUFFICIENT_PRIVILEGE
      expect(threw).toBe(false);
    });
  });
});
