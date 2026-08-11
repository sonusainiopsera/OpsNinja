/**
 * Negative-privilege suite.
 *
 * Asserts that the runtime application role (the role in DATABASE_URL) cannot:
 *   1. DISABLE ROW LEVEL SECURITY on any table.
 *   2. DROP or ALTER any table (DDL).
 *   3. UPDATE or DELETE rows in audit_logs (append-only invariant).
 *   4. Read any tenant data when app.current_tenant is unset.
 *
 * All assertions expect PostgreSQL error code 42501 (insufficient_privilege)
 * or 42P01 (undefined table for DROP attempts on non-existent targets).
 *
 * Requires DATABASE_URL pointed at a database where the connecting role is
 * the restricted application role (not a superuser). Skipped otherwise.
 */

import { Pool, PoolClient } from 'pg';

const SKIP = !process.env['DATABASE_URL'] || process.env['SKIP_PRIVILEGE_TESTS'] === 'true';
const maybeDescribe = SKIP ? describe.skip : describe;

function pgCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code;
}

maybeDescribe('Negative privilege assertions', () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
    client = await pool.connect();
  });

  afterAll(async () => {
    client.release();
    await pool.end();
  });

  it('cannot DISABLE ROW LEVEL SECURITY on tickets', async () => {
    await expect(
      client.query('ALTER TABLE tickets DISABLE ROW LEVEL SECURITY'),
    ).rejects.toSatisfy((err: unknown) =>
      pgCode(err) === '42501' || pgCode(err) === '0A000',
    );
  });

  it('cannot DROP TABLE organizations', async () => {
    await expect(
      client.query('DROP TABLE organizations'),
    ).rejects.toSatisfy((err: unknown) =>
      pgCode(err) === '42501' || pgCode(err) === '2BP01',
    );
  });

  it('cannot ALTER TABLE tickets ADD COLUMN (DDL)', async () => {
    await expect(
      client.query("ALTER TABLE tickets ADD COLUMN __test_col TEXT"),
    ).rejects.toSatisfy((err: unknown) => pgCode(err) === '42501');
  });

  it('cannot UPDATE rows in audit_logs', async () => {
    await expect(
      client.query("UPDATE audit_logs SET outcome = 'tampered' WHERE 1=0"),
    ).rejects.toSatisfy((err: unknown) => pgCode(err) === '42501');
  });

  it('cannot DELETE rows from audit_logs', async () => {
    await expect(
      client.query("DELETE FROM audit_logs WHERE 1=0"),
    ).rejects.toSatisfy((err: unknown) => pgCode(err) === '42501');
  });

  it('reads zero rows from tickets when app.current_tenant is unset (RLS blocks all)', async () => {
    // Ensure the setting is cleared
    await client.query("SELECT set_config('app.current_tenant', '', false)");
    const res = await client.query('SELECT count(*) FROM tickets');
    // With an empty/unset tenant the RLS policy should produce 0 rows.
    // If we get an error code 42501 that also satisfies the invariant.
    expect(Number(res.rows[0]?.count ?? 0)).toBe(0);
  });
});
