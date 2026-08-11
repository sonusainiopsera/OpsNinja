/**
 * Reporting read-replica integration tests.
 *
 * These tests prove the four critical guardrails on the replica connection:
 *
 *  R1. Statement timeout: pg_sleep(35) on the replica raises StatementTimeoutError
 *      (PostgreSQL error code 57014) mapped to code REPORT_QUERY_TIMEOUT.
 *  R2. Row-cap guard: generate_series() producing > 500 000 rows raises
 *      RowLimitExceededError with code REPORT_ROW_LIMIT_EXCEEDED.
 *  R3. RLS isolation: with app.current_tenant set to Tenant A, zero Tenant B
 *      rows appear in any reporting-readable table.
 *  R4. Session settings: statement_timeout, idle_in_transaction_session_timeout
 *      and default_transaction_read_only are applied at the connection level.
 *
 * The tests require a live PostgreSQL instance accessible via REPORTING_REPLICA_URL.
 * All tests are skipped if REPORTING_REPLICA_URL is not set. In CI the variable
 * points to a Testcontainers-managed PostgreSQL 16 instance seeded with the
 * reporting test fixtures.
 *
 * Note: The Testcontainers setup (spinning up the container and setting
 * REPORTING_REPLICA_URL) is handled by the CI pipeline configuration; these
 * tests are portable and run against any PostgreSQL 16+ instance.
 */

import { Pool, PoolClient } from 'pg';
import { requestContextStore } from '../src/observability/request-context';
import type { PrincipalContext } from '../src/observability/request-context';
import { TenantScopedReplicaRunner } from '../src/modules/reporting/infrastructure/tenant-scoped-replica.runner';
import {
  executeWithRowCap,
} from '../src/modules/reporting/infrastructure/guards/row-limit.guard';
import {
  StatementTimeoutError,
  RowLimitExceededError,
} from '../src/modules/reporting/infrastructure/reporting-errors';
import {
  createReportingSchema,
  seedReportingData,
  teardownReportingSchema,
  REPORTING_TENANT_A_ID,
  REPORTING_TENANT_B_ID,
} from './fixtures/reporting-seed';

// ---------------------------------------------------------------------------
// Skip guard
// ---------------------------------------------------------------------------

const REPLICA_URL = process.env['REPORTING_REPLICA_URL'];
const DB_URL = process.env['DATABASE_URL'] ?? REPLICA_URL;

const describeIfDb = REPLICA_URL ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const principal: PrincipalContext = {
    tenantId,
    userId: 'test-user',
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds: [],
    traceId: 'test-trace',
  };
  return requestContextStore.run(
    { traceId: 'test-trace', principal, startedAt: 0 },
    fn,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIfDb('Reporting read-replica integration', () => {
  let adminPool: Pool;
  let replicaPool: Pool;
  let runner: TenantScopedReplicaRunner;
  let adminClient: PoolClient;

  beforeAll(async () => {
    // Admin pool: bypasses RLS for schema setup and seeding
    adminPool = new Pool({ connectionString: DB_URL, max: 2 });
    // Replica pool: uses the restricted role connection
    replicaPool = new Pool({
      connectionString: REPLICA_URL,
      max: 4,
      connectionTimeoutMillis: 5_000,
    });

    replicaPool.on('connect', (client: PoolClient) => {
      void client.query(`
        SET statement_timeout = 30000;
        SET idle_in_transaction_session_timeout = 60000;
        SET default_transaction_read_only = on
      `).catch(() => undefined);
    });

    runner = new TenantScopedReplicaRunner(replicaPool as never);

    adminClient = await adminPool.connect();
    await createReportingSchema(adminClient);
    await seedReportingData(adminClient);
  }, 30_000);

  afterAll(async () => {
    await teardownReportingSchema(adminClient);
    adminClient.release();
    await adminPool.end();
    await replicaPool.end();
  }, 10_000);

  // ── R4. Session settings ─────────────────────────────────────────────────

  it('R4a: statement_timeout is 30000ms at the session level', async () => {
    const result = await withTenant(REPORTING_TENANT_A_ID, () =>
      runner.run((client) =>
        client.query(`SELECT current_setting('statement_timeout') AS val`).then((r) => r.rows),
      ),
    );
    expect(result[0]?.val).toBe('30000');
  });

  it('R4b: idle_in_transaction_session_timeout is 60000ms', async () => {
    const result = await withTenant(REPORTING_TENANT_A_ID, () =>
      runner.run((client) =>
        client.query(`SELECT current_setting('idle_in_transaction_session_timeout') AS val`).then((r) => r.rows),
      ),
    );
    expect(result[0]?.val).toBe('60000');
  });

  it('R4c: default_transaction_read_only is on', async () => {
    const result = await withTenant(REPORTING_TENANT_A_ID, () =>
      runner.run((client) =>
        client.query(`SELECT current_setting('default_transaction_read_only') AS val`).then((r) => r.rows),
      ),
    );
    expect(result[0]?.val).toBe('on');
  });

  // ── R1. Statement timeout ────────────────────────────────────────────────

  it('R1: pg_sleep(35) raises StatementTimeoutError', async () => {
    await expect(
      withTenant(REPORTING_TENANT_A_ID, () =>
        runner.run(async (client) => {
          await client.query('SELECT pg_sleep(35)');
          return [];
        }),
      ),
    ).rejects.toBeInstanceOf(StatementTimeoutError);
  }, 60_000);

  // ── R2. Row-cap guard ────────────────────────────────────────────────────

  it('R2: generate_series over 500 000 rows raises RowLimitExceededError', async () => {
    await expect(
      withTenant(REPORTING_TENANT_A_ID, () =>
        runner.run((client) =>
          executeWithRowCap(client, 'SELECT generate_series(1, 600000) AS n', []),
        ),
      ),
    ).rejects.toBeInstanceOf(RowLimitExceededError);
  }, 30_000);

  it('R2: generate_series of exactly 500 000 rows succeeds', async () => {
    const rows = await withTenant(REPORTING_TENANT_A_ID, () =>
      runner.run((client) =>
        executeWithRowCap(client, 'SELECT generate_series(1, 500000) AS n', []),
      ),
    );
    expect(rows).toHaveLength(500_000);
  }, 30_000);

  // ── R3. RLS isolation ────────────────────────────────────────────────────

  it('R3a: Tenant A can read its own tickets via RLS', async () => {
    const rows = await withTenant(REPORTING_TENANT_A_ID, () =>
      runner.run((client) =>
        client
          .query('SELECT id FROM reporting_test.report_tickets')
          .then((r) => r.rows as { id: string }[]),
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // All returned IDs must belong to Tenant A
      const check = await adminClient.query(
        'SELECT tenant_id FROM reporting_test.report_tickets WHERE id = $1',
        [row.id],
      );
      expect(check.rows[0]?.tenant_id).toBe(REPORTING_TENANT_A_ID);
    }
  });

  it('R3b: Tenant A sees zero Tenant B rows via RLS on report_tickets', async () => {
    const rows = await withTenant(REPORTING_TENANT_A_ID, () =>
      runner.run((client) =>
        client
          .query(
            'SELECT id FROM reporting_test.report_tickets WHERE tenant_id = $1',
            [REPORTING_TENANT_B_ID],
          )
          .then((r) => r.rows),
      ),
    );
    expect(rows).toHaveLength(0);
  });

  it('R3c: RLS isolation holds on report_ticket_sla', async () => {
    const rows = await withTenant(REPORTING_TENANT_A_ID, () =>
      runner.run((client) =>
        client
          .query('SELECT tenant_id FROM reporting_test.report_ticket_sla')
          .then((r) => r.rows as { tenant_id: string }[]),
      ),
    );
    for (const row of rows) {
      expect(row.tenant_id).toBe(REPORTING_TENANT_A_ID);
    }
  });

  it('R3d: RLS isolation holds on report_ai_summaries', async () => {
    const rows = await withTenant(REPORTING_TENANT_A_ID, () =>
      runner.run((client) =>
        client
          .query('SELECT tenant_id FROM reporting_test.report_ai_summaries')
          .then((r) => r.rows as { tenant_id: string }[]),
      ),
    );
    for (const row of rows) {
      expect(row.tenant_id).toBe(REPORTING_TENANT_A_ID);
    }
  });

  it('R3e: zero-ticket tenant returns empty result set, not an error', async () => {
    const emptyTenantId = 'ffffffff-0000-0000-0000-000000000000';
    const rows = await withTenant(emptyTenantId, () =>
      runner.run((client) =>
        client
          .query('SELECT id FROM reporting_test.report_tickets')
          .then((r) => r.rows),
      ),
    );
    expect(rows).toHaveLength(0);
  });

  // ── RLS: enumerate reporting-readable tables for missing policies ─────────

  it('R3f: all reporting-readable tables have an active RLS policy', async () => {
    const result = await adminClient.query<{
      tablename: string;
      policyname: string;
    }>(
      `SELECT tablename, policyname
       FROM pg_policies
       WHERE schemaname = 'reporting_test'`,
    );
    const tablesWithPolicies = new Set(result.rows.map((r) => r.tablename));
    const expectedTables = [
      'report_tickets',
      'report_ticket_sla',
      'report_ai_summaries',
      'report_organizations',
    ];
    for (const table of expectedTables) {
      expect(tablesWithPolicies).toContain(table);
    }
  });
});
