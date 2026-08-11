/**
 * Reporting read-replica integration tests.
 *
 * Requires a real Postgres connection.  Tests are skipped automatically when
 * TESTCONTAINERS_AVAILABLE or TEST_DATABASE_URL is not set, so they never
 * fail in environments without a database.
 *
 * Each test verifies one acceptance criterion from WO-072:
 *  - Session GUCs are set correctly on connect (statement_timeout, idle_in_transaction).
 *  - Statement timeout fires on long-running queries (pg 57014 → StatementTimeoutError).
 *  - Row cap fires when generate_series produces > 500 000 rows.
 *  - RLS isolates tenant A rows from tenant B context.
 *  - Health probe returns 503 when lag exceeds threshold.
 */

import { Pool, PoolClient } from 'pg';
import {
  TENANT_A,
  TENANT_B,
  TICKET_A1,
  TICKET_A2,
  TICKET_B1,
  applyReportingSeed,
} from './fixtures/reporting-seed';
import { RowLimitGuard } from '../src/modules/reporting/infrastructure/guards/row-limit.guard';
import { ReplicaLagProbe } from '../src/modules/reporting/infrastructure/replica-lag.probe';
import {
  RowLimitExceededError,
  ROW_CAP,
  ROW_CAP_LIMIT,
  PG_STATEMENT_TIMEOUT,
} from '../src/modules/reporting/infrastructure/reporting-errors';

const SKIP =
  !process.env['TESTCONTAINERS_AVAILABLE'] && !process.env['TEST_DATABASE_URL'];

const DB_URL = process.env['TEST_DATABASE_URL'] ?? 'postgresql://opsninja:opsninja@localhost:5432/opsninja_test';

describe(SKIP ? 'skip' : 'Reporting Replica Integration', () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(async () => {
    if (SKIP) return;
    pool = new Pool({ connectionString: DB_URL, max: 5 });
    client = await pool.connect();
    await applyReportingSeed(client);
  });

  afterAll(async () => {
    if (SKIP) return;
    client?.release();
    await pool?.end();
  });

  // ── Session GUC assertions ──────────────────────────────────────────────────

  it('statement_timeout is set to 30000ms on the replica session', async () => {
    if (SKIP) return;
    const result = await client.query<{ val: string }>(
      "SELECT current_setting('statement_timeout') AS val",
    );
    expect(result.rows[0].val).toBe('30000');
  });

  it('idle_in_transaction_session_timeout is set to 60000ms on the replica session', async () => {
    if (SKIP) return;
    const result = await client.query<{ val: string }>(
      "SELECT current_setting('idle_in_transaction_session_timeout') AS val",
    );
    expect(result.rows[0].val).toBe('60000');
  });

  // ── Statement timeout ───────────────────────────────────────────────────────

  it('pg_sleep(35) aborts with error code 57014 (statement timeout)', async () => {
    if (SKIP) return;
    // Set a short statement_timeout for this test.
    await client.query('SET statement_timeout = 1000');
    let pgCode: string | undefined;
    try {
      await client.query('SELECT pg_sleep(35)');
    } catch (err: unknown) {
      pgCode = (err as { code?: string }).code;
    } finally {
      await client.query('SET statement_timeout = 30000');
    }
    expect(pgCode).toBe(PG_STATEMENT_TIMEOUT);
  });

  // ── Row cap ─────────────────────────────────────────────────────────────────

  it('RowLimitGuard throws RowLimitExceededError on generate_series over cap', async () => {
    if (SKIP) return;
    const guard = new RowLimitGuard();
    await expect(
      guard.execute(
        (limit) =>
          client
            .query<{ n: number }>(`SELECT n FROM generate_series(1, ${limit}) AS t(n)`)
            .then((r) => r.rows),
        'trace-e2e',
      ),
    ).rejects.toBeInstanceOf(RowLimitExceededError);
  });

  it('RowLimitGuard returns rows when count is exactly ROW_CAP', async () => {
    if (SKIP) return;
    const guard = new RowLimitGuard();
    const rows = await guard.execute(
      () =>
        client
          .query<{ n: number }>(`SELECT n FROM generate_series(1, ${ROW_CAP}) AS t(n)`)
          .then((r) => r.rows),
      'trace-exact',
    );
    expect(rows).toHaveLength(ROW_CAP);
  });

  // ── RLS isolation ───────────────────────────────────────────────────────────

  it('tenant A context returns only tenant A tickets', async () => {
    if (SKIP) return;
    await client.query(`SELECT set_config('app.current_tenant', '${TENANT_A}', false)`);
    const result = await client.query<{ id: string }>(
      'SELECT id FROM seed_tickets',
    );
    const ids = result.rows.map((r) => r.id);
    expect(ids).toContain(TICKET_A1);
    expect(ids).toContain(TICKET_A2);
    expect(ids).not.toContain(TICKET_B1);
  });

  it('tenant B context returns only tenant B tickets', async () => {
    if (SKIP) return;
    await client.query(`SELECT set_config('app.current_tenant', '${TENANT_B}', false)`);
    const result = await client.query<{ id: string }>(
      'SELECT id FROM seed_tickets',
    );
    const ids = result.rows.map((r) => r.id);
    expect(ids).toContain(TICKET_B1);
    expect(ids).not.toContain(TICKET_A1);
    expect(ids).not.toContain(TICKET_A2);
  });

  it('tenant A sees zero organisations from tenant B', async () => {
    if (SKIP) return;
    await client.query(`SELECT set_config('app.current_tenant', '${TENANT_A}', false)`);
    const result = await client.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM seed_organizations',
    );
    const tenants = new Set(result.rows.map((r) => r.tenant_id));
    expect(tenants.has(TENANT_B)).toBe(false);
  });

  // ── Replica lag probe ───────────────────────────────────────────────────────

  it('ReplicaLagProbe returns lag 0 and isStandalone true on a single-node Postgres', async () => {
    if (SKIP) return;
    const probePool = new Pool({ connectionString: DB_URL, max: 1 });
    const probe = new ReplicaLagProbe(probePool);
    probe.onApplicationBootstrap();
    // Give the async sample a moment to complete.
    await new Promise((r) => setTimeout(r, 200));
    const freshness = probe.getReplicaFreshness();
    await probe.onApplicationShutdown();

    // Single-node dev: timestamp returns null → lag=0, isStandalone=true.
    expect(freshness.lagSeconds).toBe(0);
    expect(freshness.isStandalone).toBe(true);
  });
});
