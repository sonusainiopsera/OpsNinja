/**
 * Unit tests for reporting read-replica infrastructure.
 *
 * Tests cover:
 *  - TenantScopedReplicaRunner: context assertion, SET LOCAL, commit/rollback, timeout mapping
 *  - Row-cap guard: at cap, one over cap, empty result
 *  - ReplicaLagProbe: not-in-recovery null case, in-recovery lag, probe error, isHealthy
 *  - mapReplicaError: 57014 → StatementTimeoutError, ECONNREFUSED → ReplicaUnavailableError
 */

import { requestContextStore } from '../../../observability/request-context';
import type { PrincipalContext } from '../../../observability/request-context';
import { TenantContextMissingError } from '../../../data/tenant-repository';
import { TenantScopedReplicaRunner } from './tenant-scoped-replica.runner';
import {
  applyRowCapSql,
  checkRowCap,
  ROW_CAP,
} from './guards/row-limit.guard';
import {
  mapReplicaError,
  StatementTimeoutError,
  ReplicaUnavailableError,
  RowLimitExceededError,
} from './reporting-errors';
import { ReplicaLagProbe, DEFAULT_LAG_THRESHOLD_SECONDS } from './replica-lag.probe';
import { REPORTING_DB } from './reporting-db.client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = '00000000-0000-0000-0000-aaaaaaaaaaaa';

const PRINCIPAL: PrincipalContext = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  principalKind: 'staff',
  roles: ['agent'],
  orgScopeIds: [],
  traceId: 'trace-1',
};

function runWithPrincipal<T>(fn: () => Promise<T>): Promise<T> {
  return requestContextStore.run(
    { traceId: PRINCIPAL.traceId, principal: PRINCIPAL, startedAt: 0 },
    fn,
  );
}

function makeClient(queryImpl?: (text: string) => unknown) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    queries,
    query: jest.fn().mockImplementation((text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (queryImpl) return Promise.resolve(queryImpl(text));
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  };
  return client;
}

function makePool(client: ReturnType<typeof makeClient>) {
  return {
    connect: jest.fn().mockResolvedValue(client),
    on: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// TenantScopedReplicaRunner
// ---------------------------------------------------------------------------

describe('TenantScopedReplicaRunner', () => {
  it('throws TenantContextMissingError when called without principal context', async () => {
    const client = makeClient();
    const pool = makePool(client);
    const runner = new TenantScopedReplicaRunner(pool as never);

    await expect(runner.run(async () => [])).rejects.toThrow(
      TenantContextMissingError,
    );
    // Must NOT acquire a pool connection after the context check fails
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('issues BEGIN → set_config → callback → COMMIT in order', async () => {
    const client = makeClient();
    const pool = makePool(client);
    const runner = new TenantScopedReplicaRunner(pool as never);
    const cbResult = [{ id: '1' }];

    const result = await runWithPrincipal(() =>
      runner.run(async () => cbResult),
    );

    expect(result).toBe(cbResult);
    const calls: string[] = client.queries.map((q) => q.text.trim());
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toMatch(/set_config.*app\.current_tenant/);
    expect(calls[2]).toBe('COMMIT');
    expect(client.queries[1].values).toEqual([TENANT_ID]);
  });

  it('issues ROLLBACK and rethrows when callback throws', async () => {
    const client = makeClient();
    const pool = makePool(client);
    const runner = new TenantScopedReplicaRunner(pool as never);
    const boom = new Error('boom');

    await expect(
      runWithPrincipal(() =>
        runner.run(() => Promise.reject(boom)),
      ),
    ).rejects.toThrow('boom');

    const calls: string[] = client.queries.map((q) => q.text.trim());
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });

  it('releases the connection in the finally block even on error', async () => {
    const client = makeClient();
    const pool = makePool(client);
    const runner = new TenantScopedReplicaRunner(pool as never);

    await runWithPrincipal(() =>
      runner.run(() => Promise.reject(new Error('fail'))),
    ).catch(() => undefined);

    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('maps PostgreSQL error code 57014 to StatementTimeoutError', async () => {
    const pgTimeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    const client = makeClient();
    // Make the callback throw the pg error
    const pool = makePool(client);
    const runner = new TenantScopedReplicaRunner(pool as never);

    await expect(
      runWithPrincipal(() =>
        runner.run(() => Promise.reject(pgTimeout)),
      ),
    ).rejects.toBeInstanceOf(StatementTimeoutError);
  });

  it('wraps pool.connect() failure in ReplicaUnavailableError', async () => {
    const pool = { connect: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')), on: jest.fn() };
    const runner = new TenantScopedReplicaRunner(pool as never);

    await expect(
      runWithPrincipal(() => runner.run(async () => [])),
    ).rejects.toBeInstanceOf(ReplicaUnavailableError);
  });

  it('uses SET LOCAL (set_config true) so the setting is transaction-scoped', async () => {
    const client = makeClient();
    const pool = makePool(client);
    const runner = new TenantScopedReplicaRunner(pool as never);

    await runWithPrincipal(() => runner.run(async () => []));

    const setConfigCall = client.queries.find((q) =>
      q.text.includes('set_config'),
    );
    // Third argument to set_config must be 'true' (transaction-local)
    expect(setConfigCall?.text).toMatch(/set_config\('app\.current_tenant',\s*\$1,\s*true\)/);
  });
});

// ---------------------------------------------------------------------------
// Row-cap guard
// ---------------------------------------------------------------------------

describe('applyRowCapSql', () => {
  it('wraps the query in a subquery with LIMIT ROW_CAP + 1', () => {
    const original = 'SELECT id FROM tickets WHERE tenant_id = $1';
    const wrapped = applyRowCapSql(original);
    expect(wrapped).toContain(original);
    expect(wrapped).toContain(`LIMIT ${ROW_CAP + 1}`);
    expect(wrapped).toMatch(/SELECT \* FROM \(.*\) AS _row_cap_check_/s);
  });
});

describe('checkRowCap', () => {
  it('returns rows unchanged when count equals the cap', () => {
    const rows = Array.from({ length: ROW_CAP }, (_, i) => ({ id: String(i) }));
    expect(checkRowCap(rows)).toHaveLength(ROW_CAP);
  });

  it('throws RowLimitExceededError when count exceeds the cap', () => {
    const rows = Array.from({ length: ROW_CAP + 1 }, (_, i) => ({ id: String(i) }));
    expect(() => checkRowCap(rows)).toThrow(RowLimitExceededError);
    const err = (() => { try { checkRowCap(rows); } catch (e) { return e; } })() as RowLimitExceededError;
    expect(err.code).toBe('REPORT_ROW_LIMIT_EXCEEDED');
    expect(err.cap).toBe(ROW_CAP);
  });

  it('returns empty array for empty result', () => {
    expect(checkRowCap([])).toHaveLength(0);
  });

  it('a result of exactly 1 row succeeds', () => {
    expect(checkRowCap([{ id: '1' }])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mapReplicaError
// ---------------------------------------------------------------------------

describe('mapReplicaError', () => {
  it('maps pg code 57014 to StatementTimeoutError', () => {
    const err = Object.assign(new Error('timeout'), { code: '57014' });
    expect(mapReplicaError(err)).toBeInstanceOf(StatementTimeoutError);
  });

  it('maps ECONNREFUSED to ReplicaUnavailableError', () => {
    const err = Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' });
    expect(mapReplicaError(err)).toBeInstanceOf(ReplicaUnavailableError);
  });

  it('maps ETIMEDOUT to ReplicaUnavailableError', () => {
    const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    expect(mapReplicaError(err)).toBeInstanceOf(ReplicaUnavailableError);
  });

  it('passes through unknown pg errors unchanged', () => {
    const err = Object.assign(new Error('syntax error'), { code: '42601' });
    expect(mapReplicaError(err)).toBe(err);
  });

  it('passes through non-object values unchanged', () => {
    expect(mapReplicaError('string error')).toBe('string error');
    expect(mapReplicaError(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ReplicaLagProbe
// ---------------------------------------------------------------------------

describe('ReplicaLagProbe', () => {
  const makeProbe = (queryResult: Record<string, unknown>) => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [queryResult] }),
      release: jest.fn(),
    };
    const mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient),
      on: jest.fn(),
    };
    const probe = new ReplicaLagProbe(mockPool as never);
    return { probe, mockPool, mockClient };
  };

  it('reports lagSeconds 0 and isInRecovery false for a standalone node (null timestamp)', async () => {
    const { probe } = makeProbe({ lag_seconds: null, is_in_recovery: false });
    probe.onModuleInit();
    // Wait for the initial probe to complete
    await new Promise((r) => setImmediate(r));
    probe.onModuleDestroy();

    const f = probe.getReplicaFreshness();
    expect(f.lagSeconds).toBe(0);
    expect(f.isInRecovery).toBe(false);
    expect(f.probeError).toBeNull();
  });

  it('reports lag from pg_last_xact_replay_timestamp when in recovery', async () => {
    const { probe } = makeProbe({ lag_seconds: '5.123', is_in_recovery: true });
    probe.onModuleInit();
    await new Promise((r) => setImmediate(r));
    probe.onModuleDestroy();

    const f = probe.getReplicaFreshness();
    expect(f.lagSeconds).toBeCloseTo(5.123);
    expect(f.isInRecovery).toBe(true);
  });

  it('sets probeError and does not crash when pool.connect() fails', async () => {
    const mockPool = {
      connect: jest.fn().mockRejectedValue(new Error('connection refused')),
      on: jest.fn(),
    };
    const probe = new ReplicaLagProbe(mockPool as never);
    probe.onModuleInit();
    await new Promise((r) => setImmediate(r));
    probe.onModuleDestroy();

    const f = probe.getReplicaFreshness();
    expect(f.probeError).toBeTruthy();
  });

  it('isHealthy returns false when probeError is set', async () => {
    const mockPool = {
      connect: jest.fn().mockRejectedValue(new Error('fail')),
      on: jest.fn(),
    };
    const probe = new ReplicaLagProbe(mockPool as never);
    probe.onModuleInit();
    await new Promise((r) => setImmediate(r));
    probe.onModuleDestroy();

    expect(probe.isHealthy()).toBe(false);
  });

  it(`isHealthy returns false when lag exceeds ${DEFAULT_LAG_THRESHOLD_SECONDS}s`, async () => {
    const { probe } = makeProbe({ lag_seconds: String(DEFAULT_LAG_THRESHOLD_SECONDS + 1), is_in_recovery: true });
    probe.onModuleInit();
    await new Promise((r) => setImmediate(r));
    probe.onModuleDestroy();

    expect(probe.isHealthy()).toBe(false);
  });

  it('isHealthy returns true for a healthy standalone node', async () => {
    const { probe } = makeProbe({ lag_seconds: null, is_in_recovery: false });
    probe.onModuleInit();
    await new Promise((r) => setImmediate(r));
    probe.onModuleDestroy();

    expect(probe.isHealthy()).toBe(true);
  });

  it('getReplicaFreshness returns a defensive copy (not mutable shared state)', async () => {
    const { probe } = makeProbe({ lag_seconds: null, is_in_recovery: false });
    probe.onModuleInit();
    await new Promise((r) => setImmediate(r));
    probe.onModuleDestroy();

    const a = probe.getReplicaFreshness();
    const b = probe.getReplicaFreshness();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// REPORTING_DB token
// ---------------------------------------------------------------------------

describe('REPORTING_DB token', () => {
  it('is a Symbol', () => {
    expect(typeof REPORTING_DB).toBe('symbol');
  });

  it('has a unique identity (not equal to any string)', () => {
    expect(REPORTING_DB).not.toBe('REPORTING_DB');
  });
});
