/**
 * Negative Privilege Suite
 *
 * Connects as the application database role (opsninja_app or the role
 * specified by DB_APP_ROLE) and asserts it is denied operations that
 * could undermine tenant isolation:
 *
 *   1. DISABLE ROW LEVEL SECURITY on a tenant-scoped table
 *   2. DDL: ALTER TABLE rename column
 *   3. DDL: DROP TABLE
 *   4. UPDATE on audit_logs (audit trail must be append-only)
 *   5. DELETE on audit_logs
 *   6. SELECT without app.current_tenant set (RLS must deny)
 *
 * The test expects PostgreSQL error code 42501 (insufficient_privilege)
 * for all denied operations.
 *
 * Skip condition: set ISOLATION_TEST_DB_URL or TEST_DATABASE_URL.
 */

import { Pool } from 'pg';

const DB_URL = process.env.ISOLATION_TEST_DB_URL ?? process.env.TEST_DATABASE_URL;
const SKIP = !DB_URL;

const EXPECTED_PG_ERROR = '42501'; // insufficient_privilege

async function expectDenied(pool: Pool, sql: string, params?: unknown[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_tenant', '00000000-0000-0000-0000-000000000001', true)`);
    let caught: unknown = null;
    try {
      await client.query(sql, params as unknown[]);
    } catch (err) {
      caught = err;
    } finally {
      await client.query('ROLLBACK');
    }
    if (!caught) {
      throw new Error(`Expected SQL to be denied but it succeeded:\n  ${sql}`);
    }
    const pgErr = caught as { code?: string; message?: string };
    if (pgErr.code !== EXPECTED_PG_ERROR) {
      throw new Error(
        `Expected PG error ${EXPECTED_PG_ERROR} (insufficient_privilege) but got ${pgErr.code}: ${pgErr.message}\nSQL: ${sql}`,
      );
    }
  } finally {
    client.release();
  }
}

async function expectDeniedWithoutTenant(pool: Pool, sql: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Deliberately do NOT set app.current_tenant — RLS must return zero rows or deny
    let rows: unknown[] = [];
    let caught: unknown = null;
    try {
      const result = await client.query(sql);
      rows = result.rows;
    } catch (err) {
      caught = err;
    } finally {
      await client.query('ROLLBACK');
    }
    if (caught) {
      const pgErr = caught as { code?: string };
      if (pgErr.code !== EXPECTED_PG_ERROR && pgErr.code !== '42501') {
        throw new Error(`Unexpected error ${(pgErr as { code?: string }).code}: ${JSON.stringify(caught)}`);
      }
      return; // denied as expected
    }
    if (rows.length > 0) {
      throw new Error(
        `Expected zero rows without tenant context but got ${rows.length} rows. ` +
          'RLS must deny unbound reads.',
      );
    }
    // Zero rows also counts as denied (RLS filtered everything)
  } finally {
    client.release();
  }
}

const describeOrSkip = SKIP ? describe.skip : describe;
describeOrSkip('Negative Privilege Suite', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL!, max: 2 });
    await pool.query('SELECT 1'); // verify connectivity
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('runtime role cannot DISABLE ROW LEVEL SECURITY on tickets', async () => {
    await expectDenied(pool, 'ALTER TABLE tickets DISABLE ROW LEVEL SECURITY');
  });

  it('runtime role cannot ALTER TABLE tickets to rename a column', async () => {
    await expectDenied(pool, 'ALTER TABLE tickets RENAME COLUMN subject TO subject_renamed');
  });

  it('runtime role cannot DROP TABLE tickets', async () => {
    await expectDenied(pool, 'DROP TABLE tickets');
  });

  it('runtime role cannot UPDATE audit_logs (append-only invariant)', async () => {
    await expectDenied(
      pool,
      `UPDATE audit_logs SET resource_type = 'hacked' WHERE tenant_id = '00000000-0000-0000-0000-000000000001'`,
    );
  });

  it('runtime role cannot DELETE from audit_logs (append-only invariant)', async () => {
    await expectDenied(
      pool,
      `DELETE FROM audit_logs WHERE tenant_id = '00000000-0000-0000-0000-000000000001'`,
    );
  });

  it('SELECT from tickets without app.current_tenant set returns zero rows (RLS denies)', async () => {
    await expectDeniedWithoutTenant(pool, 'SELECT id FROM tickets LIMIT 10');
  });

  it('SELECT from organizations without app.current_tenant set returns zero rows (RLS denies)', async () => {
    await expectDeniedWithoutTenant(pool, 'SELECT id FROM organizations LIMIT 10');
  });
});

describe('Negative Privilege Suite (unit)', () => {
  it('EXPECTED_PG_ERROR code is the PostgreSQL insufficient_privilege code', () => {
    expect(EXPECTED_PG_ERROR).toBe('42501');
  });
});
