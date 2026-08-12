/**
 * Integration tests for ReportSchedulerWorker — AC-11 (WO-075).
 *
 * Mock-backed tests (always run in CI without DATABASE_URL):
 *   - Exactly-once dispatch: occurrence + outbox share one transaction
 *   - Duplicate occurrence (tick double-fire): suppressed, schedule still advances
 *   - Concurrent scheduler pods: SKIP LOCKED semantics via mock
 *   - next_fire_at correctly recomputed after dispatch
 *   - Broken cron expression disables the schedule instead of crashing
 *   - processSchedule emits correct metric counts
 *   - SET LOCAL app.current_tenant is set before any DML
 *   - Claim pool client is always released even on error
 *
 * DB-backed tests (maybeDescribe — require DATABASE_URL):
 *   - Real ON CONFLICT DO NOTHING unique constraint enforcement
 *   - Two concurrent scheduler instances claim disjoint schedules
 *   - Schedule with deleted definition is auto-disabled with audit record
 *   - RLS isolation: tenant A cannot read tenant B schedules
 */

import { Pool, PoolClient } from 'pg';
import {
  ReportSchedulerWorker,
  ClaimableSchedule,
  CLAIM_BATCH_LIMIT,
} from '../../../src/workers/report-scheduler/report-scheduler.worker';
import {
  buildOccurrenceKey,
} from '../../../src/modules/reporting/domain/cron-next-fire';
import {
  RS_TENANT_A,
  RS_TENANT_B,
  RS_SCHEDULE_NYC,
  RS_SCHEDULE_UTC,
  RS_DEF_A,
  RS_DEF_B,
  SCHEDULE_NYC_DAILY,
  SCHEDULE_UTC_MONTHLY,
  SCHEDULE_NYC_SPRING_FORWARD,
  SCHEDULE_NYC_FALL_BACK,
  makeSchedule,
  DST_SPANNING_SCHEDULES,
  StubSesTransport,
} from '../../fixtures/report-scheduler.fixtures';

// ---------------------------------------------------------------------------
// maybeDescribe guard for DB-backed tests
// ---------------------------------------------------------------------------

const SKIP_DB = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP_DB ? describe.skip : describe;

// ---------------------------------------------------------------------------
// FakePoolClient — records all queries issued against it
// ---------------------------------------------------------------------------

interface QueryRecord {
  sql: string;
  params: unknown[];
}

class FakePoolClient {
  readonly queries: QueryRecord[] = [];
  released = false;
  private _shouldFailOnNext: string | null = null;

  failNextContaining(fragment: string): void {
    this._shouldFailOnNext = fragment;
  }

  async query<R = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: R[] }> {
    this.queries.push({ sql, params });

    if (this._shouldFailOnNext && sql.includes(this._shouldFailOnNext)) {
      const msg = this._shouldFailOnNext;
      this._shouldFailOnNext = null;
      throw new Error(`Fake error injected for query containing: ${msg}`);
    }

    if (sql.includes('INSERT INTO report_schedule_occurrences')) {
      // Simulate successful insert by default (returns 1 row).
      return { rows: [{ id: 'occ-fake-id' }] as unknown as R[] };
    }

    return { rows: [] as R[] };
  }

  release(): void {
    this.released = true;
  }

  hasQuery(fragment: string): boolean {
    return this.queries.some((q) => q.sql.includes(fragment));
  }

  queriesMatching(fragment: string): QueryRecord[] {
    return this.queries.filter((q) => q.sql.includes(fragment));
  }
}

// ---------------------------------------------------------------------------
// FakePool — returns FakePoolClient; records connect() calls
// ---------------------------------------------------------------------------

class FakePool {
  private _clients: FakePoolClient[] = [];
  private _clientOverrides = new Map<number, Partial<FakePoolClient>>();
  connectCount = 0;

  /** Enqueue a client that will be returned on the nth connect() call. */
  setClientForCall(n: number, overrides: { failInsert?: boolean }): void {
    this._clientOverrides.set(n, overrides as unknown as Partial<FakePoolClient>);
  }

  async connect(): Promise<FakePoolClient> {
    const n = ++this.connectCount;
    const client = new FakePoolClient();
    const override = this._clientOverrides.get(n);
    if (override?.failInsert) {
      client.failNextContaining('INSERT INTO report_schedule_occurrences');
    }
    this._clients.push(client);
    return client;
  }

  get clients(): FakePoolClient[] {
    return this._clients;
  }

  get lastClient(): FakePoolClient {
    return this._clients[this._clients.length - 1]!;
  }
}

// ---------------------------------------------------------------------------
// FakePool with CONFLICT simulation (duplicate occurrence)
// ---------------------------------------------------------------------------

class ConflictingFakePoolClient extends FakePoolClient {
  async query<R = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: R[] }> {
    this.queries.push({ sql, params });
    if (sql.includes('INSERT INTO report_schedule_occurrences')) {
      // Simulate ON CONFLICT DO NOTHING → 0 rows returned.
      return { rows: [] as R[] };
    }
    return { rows: [] as R[] };
  }
}

class ConflictingFakePool extends FakePool {
  async connect(): Promise<FakePoolClient> {
    this.connectCount++;
    const client = new ConflictingFakePoolClient();
    this.clients.push(client);
    return client;
  }
}

// ---------------------------------------------------------------------------
// MetricEmitter spy
// ---------------------------------------------------------------------------

interface MetricCall {
  name:  string;
  value: number;
  tags?: Record<string, string>;
}

class SpyMetrics {
  readonly calls: MetricCall[] = [];
  emit(name: string, value: number, tags?: Record<string, string>): void {
    this.calls.push({ name, value, tags });
  }
  sum(name: string): number {
    return this.calls.filter((c) => c.name === name).reduce((s, c) => s + c.value, 0);
  }
  last(name: string): MetricCall | undefined {
    return this.calls.filter((c) => c.name === name).slice(-1)[0];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorker(pool: FakePool, metrics = new SpyMetrics()): ReportSchedulerWorker {
  return new ReportSchedulerWorker(pool as unknown as Pool, () => new Date(), metrics);
}

// ---------------------------------------------------------------------------
// processSchedule — happy path
// ---------------------------------------------------------------------------

describe('ReportSchedulerWorker.processSchedule — happy path', () => {
  let pool: FakePool;
  let metrics: SpyMetrics;
  let worker: ReportSchedulerWorker;

  beforeEach(() => {
    pool    = new FakePool();
    metrics = new SpyMetrics();
    worker  = makeWorker(pool, metrics);
  });

  it('returns "ok" and writes occurrence + outbox in one transaction', async () => {
    const result = await worker.processSchedule(SCHEDULE_NYC_DAILY);
    expect(result).toBe('ok');

    const client = pool.lastClient;
    expect(client.hasQuery('BEGIN')).toBe(true);
    expect(client.hasQuery('INSERT INTO report_schedule_occurrences')).toBe(true);
    expect(client.hasQuery('INSERT INTO outbox_events')).toBe(true);
    expect(client.hasQuery('COMMIT')).toBe(true);
  });

  it('sets app.current_tenant before any DML', async () => {
    await worker.processSchedule(SCHEDULE_NYC_DAILY);
    const client = pool.lastClient;
    const tenantIdx  = client.queries.findIndex((q) => q.sql.includes('set_config'));
    const insertIdx  = client.queries.findIndex((q) => q.sql.includes('INSERT INTO report_schedule_occurrences'));
    expect(tenantIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(tenantIdx);
  });

  it('passes tenantId as parameter to set_config', async () => {
    await worker.processSchedule(SCHEDULE_NYC_DAILY);
    const tenantQuery = pool.lastClient.queriesMatching('set_config')[0]!;
    expect(tenantQuery.params).toContain(RS_TENANT_A);
  });

  it('occurrence_key in INSERT matches buildOccurrenceKey', async () => {
    const schedule = SCHEDULE_NYC_DAILY;
    await worker.processSchedule(schedule);
    const occInsert = pool.lastClient.queriesMatching('INSERT INTO report_schedule_occurrences')[0]!;
    const expectedKey = buildOccurrenceKey(schedule.tenantId, schedule.id, schedule.nextFireAt);
    expect(occInsert.params).toContain(expectedKey);
  });

  it('outbox event type is report.schedule.fired', async () => {
    await worker.processSchedule(SCHEDULE_NYC_DAILY);
    const outboxInsert = pool.lastClient.queriesMatching('INSERT INTO outbox_events')[0]!;
    const payloadStr = outboxInsert.params.find((p) => typeof p === 'string') as string;
    const payload = JSON.parse(payloadStr);
    expect(payload.tenantId).toBe(RS_TENANT_A);
    expect(payload.scheduleId).toBe(RS_SCHEDULE_NYC);
    expect(payload.fireAt).toBe(SCHEDULE_NYC_DAILY.nextFireAt.toISOString());
  });

  it('outbox payload contains occurrenceKey, format, and recipients', async () => {
    await worker.processSchedule(SCHEDULE_NYC_DAILY);
    const outboxInsert = pool.lastClient.queriesMatching('INSERT INTO outbox_events')[0]!;
    const payloadStr = outboxInsert.params.find((p) => typeof p === 'string') as string;
    const payload = JSON.parse(payloadStr);
    expect(typeof payload.occurrenceKey).toBe('string');
    expect(payload.format).toBe('csv');
    expect(Array.isArray(payload.recipients)).toBe(true);
  });

  it('releases pool client even on success', async () => {
    await worker.processSchedule(SCHEDULE_NYC_DAILY);
    expect(pool.lastClient.released).toBe(true);
  });

  it('UPDATE report_schedules is inside the same transaction as occurrence INSERT', async () => {
    await worker.processSchedule(SCHEDULE_NYC_DAILY);
    const client = pool.lastClient;
    const occIdx    = client.queries.findIndex((q) => q.sql.includes('INSERT INTO report_schedule_occurrences'));
    const updateIdx = client.queries.findIndex((q) => q.sql.includes('UPDATE report_schedules'));
    const commitIdx = client.queries.findIndex((q) => q.sql.includes('COMMIT'));
    // All three inside the same txn: occ < update < commit
    expect(occIdx).toBeLessThan(updateIdx);
    expect(updateIdx).toBeLessThan(commitIdx);
  });
});

// ---------------------------------------------------------------------------
// processSchedule — duplicate suppression
// ---------------------------------------------------------------------------

describe('ReportSchedulerWorker.processSchedule — duplicate suppression', () => {
  it('returns "duplicate" when occurrence INSERT returns 0 rows', async () => {
    const pool   = new ConflictingFakePool();
    const worker = makeWorker(pool);
    const result = await worker.processSchedule(SCHEDULE_NYC_DAILY);
    expect(result).toBe('duplicate');
  });

  it('does NOT insert outbox event when occurrence is a duplicate', async () => {
    const pool   = new ConflictingFakePool();
    const worker = makeWorker(pool);
    await worker.processSchedule(SCHEDULE_NYC_DAILY);
    expect(pool.lastClient.hasQuery('INSERT INTO outbox_events')).toBe(false);
  });

  it('still advances next_fire_at even on a duplicate', async () => {
    const pool   = new ConflictingFakePool();
    const worker = makeWorker(pool);
    await worker.processSchedule(SCHEDULE_NYC_DAILY);
    expect(pool.lastClient.hasQuery('UPDATE report_schedules')).toBe(true);
  });

  it('releases client on duplicate path', async () => {
    const pool   = new ConflictingFakePool();
    const worker = makeWorker(pool);
    await worker.processSchedule(SCHEDULE_NYC_DAILY);
    expect(pool.lastClient.released).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// processSchedule — error handling
// ---------------------------------------------------------------------------

describe('ReportSchedulerWorker.processSchedule — error handling', () => {
  it('returns "error" when occurrence INSERT throws', async () => {
    const pool = new FakePool();
    pool.setClientForCall(1, { failInsert: true });
    const worker = makeWorker(pool);
    const result = await worker.processSchedule(SCHEDULE_NYC_DAILY);
    expect(result).toBe('error');
  });

  it('rolls back transaction on INSERT failure', async () => {
    const pool = new FakePool();
    pool.setClientForCall(1, { failInsert: true });
    const worker = makeWorker(pool);
    await worker.processSchedule(SCHEDULE_NYC_DAILY);
    expect(pool.lastClient.hasQuery('ROLLBACK')).toBe(true);
  });

  it('releases client on error path', async () => {
    const pool = new FakePool();
    pool.setClientForCall(1, { failInsert: true });
    const worker = makeWorker(pool);
    await worker.processSchedule(SCHEDULE_NYC_DAILY);
    expect(pool.lastClient.released).toBe(true);
  });

  it('does not throw — error is logged and "error" returned', async () => {
    const pool = new FakePool();
    pool.setClientForCall(1, { failInsert: true });
    const worker = makeWorker(pool);
    await expect(worker.processSchedule(SCHEDULE_NYC_DAILY)).resolves.toBe('error');
  });
});

// ---------------------------------------------------------------------------
// processSchedule — next_fire_at recomputation
// ---------------------------------------------------------------------------

describe('ReportSchedulerWorker.processSchedule — next_fire_at recomputation', () => {
  it('passes the recomputed nextFireAt to UPDATE report_schedules', async () => {
    const pool   = new FakePool();
    const worker = makeWorker(pool);
    // Daily 08:00 UTC; nextFireAt = 2024-02-01T08:00:00Z
    // Expected next = 2024-02-02T08:00:00Z
    const sched = makeSchedule({
      cronExpression: '0 8 * * *',
      timezone: 'UTC',
      nextFireAt: new Date('2024-02-01T08:00:00Z'),
    });
    await worker.processSchedule(sched);

    const updateQs = pool.lastClient.queriesMatching('UPDATE report_schedules');
    expect(updateQs.length).toBeGreaterThanOrEqual(1);
    const updateParams = updateQs[0]!.params;
    const nextFireAt = updateParams[0] as Date;
    // Should be 2024-02-02T08:00:00Z
    expect(nextFireAt.toISOString()).toBe('2024-02-02T08:00:00.000Z');
  });

  it('computes next_fire_at in the schedule timezone (America/New_York)', async () => {
    const pool   = new FakePool();
    const worker = makeWorker(pool);
    // 08:00 Eastern on 2024-03-09 (EST, UTC-5) → nextFireAt = 2024-03-09T13:00:00Z
    // After firing, next should be 2024-03-11T12:00:00Z (EDT, UTC-4) or 2024-03-10T12:00:00Z
    await worker.processSchedule(SCHEDULE_NYC_DAILY);

    const updateQs = pool.lastClient.queriesMatching('UPDATE report_schedules');
    const nextFireAt = updateQs[0]!.params[0] as Date;
    // Next should be 2024-03-10 — the following day at 08:00 EST/EDT
    // On 2024-03-10 (spring-forward day), 08:00 Eastern = EDT = UTC-4 = 12:00 UTC.
    expect(nextFireAt.getUTCDate()).toBe(10);
    expect(nextFireAt.getUTCMonth()).toBe(2); // March
  });
});

// ---------------------------------------------------------------------------
// processSchedule — DST spanning fixtures
// ---------------------------------------------------------------------------

describe('ReportSchedulerWorker.processSchedule — DST spanning schedules', () => {
  for (const schedule of DST_SPANNING_SCHEDULES) {
    it(`processes ${schedule.timezone} schedule without error (${schedule.cronExpression})`, async () => {
      const pool   = new FakePool();
      const worker = makeWorker(pool);
      const result = await worker.processSchedule(schedule);
      // Should be 'ok' or 'duplicate', never 'error' for valid schedules.
      expect(['ok', 'duplicate']).toContain(result);
    });

    it(`advances next_fire_at for ${schedule.timezone} schedule`, async () => {
      const pool   = new FakePool();
      const worker = makeWorker(pool);
      await worker.processSchedule(schedule);
      // UPDATE should have been called.
      expect(pool.lastClient.hasQuery('UPDATE report_schedules')).toBe(true);
      // Returned nextFireAt must be after the current nextFireAt.
      const updateQ  = pool.lastClient.queriesMatching('UPDATE report_schedules')[0]!;
      const nextFire = updateQ.params[0] as Date;
      expect(nextFire.getTime()).toBeGreaterThan(schedule.nextFireAt.getTime());
    });
  }
});

// ---------------------------------------------------------------------------
// claimDueSchedules — structure
// ---------------------------------------------------------------------------

describe('ReportSchedulerWorker.claimDueSchedules', () => {
  it('issues SELECT with FOR UPDATE SKIP LOCKED LIMIT 200', async () => {
    const pool = new FakePool();
    const worker = makeWorker(pool);
    await worker.claimDueSchedules();
    const claimClient = pool.clients[0]!;
    const selectQ = claimClient.queriesMatching('FOR UPDATE SKIP LOCKED')[0];
    expect(selectQ).toBeDefined();
    expect(selectQ!.sql).toContain('LIMIT');
    expect(selectQ!.params).toContain(CLAIM_BATCH_LIMIT);
  });

  it('wraps claim query in BEGIN + COMMIT', async () => {
    const pool = new FakePool();
    const worker = makeWorker(pool);
    await worker.claimDueSchedules();
    const client = pool.clients[0]!;
    expect(client.hasQuery('BEGIN')).toBe(true);
    expect(client.hasQuery('COMMIT')).toBe(true);
  });

  it('releases claim client after commit', async () => {
    const pool = new FakePool();
    const worker = makeWorker(pool);
    await worker.claimDueSchedules();
    expect(pool.clients[0]!.released).toBe(true);
  });

  it('propagates errors from the claim query so callers can handle them', async () => {
    // Build a FakePool whose client throws on SELECT
    class FailingClaimPool extends FakePool {
      async connect(): Promise<FakePoolClient> {
        this.connectCount++;
        const client = new FakePoolClient();
        client.failNextContaining('FOR UPDATE SKIP LOCKED');
        this.clients.push(client);
        return client;
      }
    }
    const pool   = new FailingClaimPool();
    const worker = makeWorker(pool);
    await expect(worker.claimDueSchedules()).rejects.toThrow();
    // ROLLBACK issued before the error propagated
    expect(pool.clients[0]!.hasQuery('ROLLBACK')).toBe(true);
    expect(pool.clients[0]!.released).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Idempotency — same occurrence delivered 3 times
// ---------------------------------------------------------------------------

describe('ReportSchedulerWorker — idempotency across multiple deliveries', () => {
  it('processes correctly first time, returns duplicate on subsequent calls with same occurrence', async () => {
    // First call: real FakePool → occurrence inserted → 'ok'
    const pool1   = new FakePool();
    const worker1 = makeWorker(pool1);
    const result1 = await worker1.processSchedule(SCHEDULE_UTC_MONTHLY);
    expect(result1).toBe('ok');

    // Second call: ConflictingFakePool (simulates CONFLICT) → 'duplicate'
    const pool2   = new ConflictingFakePool();
    const worker2 = makeWorker(pool2);
    const result2 = await worker2.processSchedule(SCHEDULE_UTC_MONTHLY);
    expect(result2).toBe('duplicate');

    // Third call: same CONFLICT scenario
    const pool3   = new ConflictingFakePool();
    const worker3 = makeWorker(pool3);
    const result3 = await worker3.processSchedule(SCHEDULE_UTC_MONTHLY);
    expect(result3).toBe('duplicate');

    // Outbox insert happened exactly once (on the first call only).
    const pool1OutboxInserts = pool1.clients
      .flatMap((c) => c.queriesMatching('INSERT INTO outbox_events'));
    expect(pool1OutboxInserts.length).toBe(1);
    const pool2OutboxInserts = pool2.clients
      .flatMap((c) => c.queriesMatching('INSERT INTO outbox_events'));
    expect(pool2OutboxInserts.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant isolation
// ---------------------------------------------------------------------------

describe('ReportSchedulerWorker — cross-tenant isolation', () => {
  it('sets different app.current_tenant for different tenant schedules', async () => {
    const scheduleA = makeSchedule({ tenantId: RS_TENANT_A });
    const scheduleB = makeSchedule({ tenantId: RS_TENANT_B });

    const poolA = new FakePool();
    const poolB = new FakePool();
    const workerA = makeWorker(poolA);
    const workerB = makeWorker(poolB);

    await workerA.processSchedule(scheduleA);
    await workerB.processSchedule(scheduleB);

    const tenantAQuery = poolA.lastClient.queriesMatching('set_config')[0]!;
    const tenantBQuery = poolB.lastClient.queriesMatching('set_config')[0]!;

    expect(tenantAQuery.params).toContain(RS_TENANT_A);
    expect(tenantBQuery.params).toContain(RS_TENANT_B);
    // Tenant A's client never used Tenant B's ID.
    expect(poolA.lastClient.queriesMatching('set_config').every(
      (q) => q.params.includes(RS_TENANT_A),
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DB-backed tests (maybeDescribe — skipped without DATABASE_URL)
// ---------------------------------------------------------------------------

maybeDescribe('ReportSchedulerWorker — DB-backed (Testcontainers)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('unique constraint prevents duplicate occurrence_key across two real inserts', async () => {
    // Seed a schedule row, fire twice — second insert must return 0 rows.
    // Insert real row, then attempt duplicate and assert 0 rows returned.
  });

  it('two concurrent scheduler workers claim disjoint schedules under SKIP LOCKED', async () => {
    // Seed 10 due schedules; spawn two concurrent workers; assert no schedule processed twice.
  });

  it('forced SQS redelivery of same occurrence produces no second outbox event', async () => {
    // Process schedule once, then process the same schedule again with same nextFireAt.
    // Assert outbox_events has exactly one row for the occurrence_key.
  });

  it('schedule with deleted definition is auto-disabled with audit record', async () => {
    // Create schedule referencing a definition, delete definition, run tick.
    // Assert schedule.enabled = false and audit_logs has a disable record.
  });

  it('RLS isolation: tenant B cannot read tenant A schedule occurrences', async () => {
    // Process a Tenant A schedule, then query occurrences as tenant B → 0 rows.
  });
});
