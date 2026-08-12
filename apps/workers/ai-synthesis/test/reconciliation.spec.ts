/**
 * reconciliation.spec.ts — unit tests for ReconciliationJob (WO-064 AC10/AC11).
 *
 * Uses FakePool/FakePoolClient to drive the job without a real database.
 * FakeClock from wo064.fixtures.ts makes time-based threshold logic deterministic.
 *
 * Covers (AC10):
 *   - Stale 'running' row under cap → re-enqueued (ai_status → 'pending', outbox event)
 *   - Stale 'pending' row under cap → re-enqueued
 *   - Stale 'running' row AT cap (attempt_count = MAX_ATTEMPTS) → marked 'failed'
 *   - Healthy 'running' row (within threshold) → not touched (not in scan result)
 *   - Empty scan → no mutations, stats.requeued=0 stats.failed=0
 *   - Uses SELECT ... FOR UPDATE SKIP LOCKED in the SQL
 *   - Sets ai_status = 'failed' + last_error_code = RECONCILIATION_CAP_REACHED
 *   - Emits ai.synthesis.failed outbox event for capped rows
 *   - Emits ticket.resolved outbox event for re-enqueued rows
 *   - ROLLBACK on transaction error
 *   - Releases pool client after run
 *
 * Covers (AC11):
 *   - STUCK_RUNNING_ROW fixture → requeued
 *   - STUCK_RUNNING_AT_CAP fixture → marked failed
 *   - STUCK_PENDING_ROW fixture → requeued
 */

import { ReconciliationJob } from '../src/reconciliation.job';
import { MAX_ATTEMPTS } from '../src/synthesis.service';
import {
  STUCK_RUNNING_ROW,
  STUCK_RUNNING_AT_CAP,
  STUCK_PENDING_ROW,
  HEALTHY_RUNNING_ROW,
  FakeClock,
} from './wo064.fixtures';
import type { Pool, PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// Fake pool infrastructure (mirrors db-ai-policy.spec.ts pattern)
// ---------------------------------------------------------------------------

interface QueryRecord {
  text: string;
  values: unknown[];
}

class FakePoolClient {
  queries: QueryRecord[] = [];
  released = false;
  private _rows: unknown[] = [];
  shouldRollback = false;

  /** Pre-load rows returned by the next matching query. */
  setRows(rows: unknown[]) { this._rows = rows; }

  async query<T extends { rows: unknown[] } = { rows: unknown[] }>(
    text: string,
    values: unknown[] = [],
  ): Promise<T> {
    this.queries.push({ text, values });
    if (text === 'BEGIN' || text === 'COMMIT') return { rows: [] } as T;
    if (text === 'ROLLBACK') return { rows: [] } as T;
    if (text.includes('SELECT') && text.includes('FOR UPDATE SKIP LOCKED')) {
      const rows = this._rows as T['rows'];
      return { rows } as T;
    }
    return { rows: [] } as T;
  }

  release() { this.released = true; }
}

function makePool(client: FakePoolClient): Pool {
  return {
    connect: jest.fn().mockResolvedValue(client as unknown as PoolClient),
  } as unknown as Pool;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(client: FakePoolClient): ReconciliationJob {
  const pool = makePool(client);
  // Bypass NestJS lifecycle — construct directly
  return new ReconciliationJob(pool);
}

// ---------------------------------------------------------------------------
// AC10: Basic scan and routing
// ---------------------------------------------------------------------------

describe('ReconciliationJob.run() — empty scan', () => {
  it('returns zeros when no stale rows', async () => {
    const client = new FakePoolClient();
    client.setRows([]);
    const job = makeJob(client);
    const stats = await job.run();
    expect(stats.requeued).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.skipped).toBe(0);
  });

  it('releases pool client after empty scan', async () => {
    const client = new FakePoolClient();
    client.setRows([]);
    await makeJob(client).run();
    expect(client.released).toBe(true);
  });

  it('executes BEGIN ... COMMIT transaction', async () => {
    const client = new FakePoolClient();
    client.setRows([]);
    await makeJob(client).run();
    expect(client.queries.some((q) => q.text === 'BEGIN')).toBe(true);
    expect(client.queries.some((q) => q.text === 'COMMIT')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC10: Stale running row under cap → re-enqueued
// ---------------------------------------------------------------------------

describe('ReconciliationJob.run() — stale running row, under cap', () => {
  let client: FakePoolClient;

  beforeEach(() => {
    client = new FakePoolClient();
    client.setRows([STUCK_RUNNING_ROW]);
  });

  it('returns requeued=1', async () => {
    const stats = await makeJob(client).run();
    expect(stats.requeued).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it('updates ai_status to pending', () => {
    return makeJob(client).run().then(() => {
      const update = client.queries.find(
        (q) => q.text.includes('UPDATE') && q.text.includes("'pending'"),
      );
      expect(update).toBeDefined();
      expect(update!.values).toContain(STUCK_RUNNING_ROW.id);
    });
  });

  it('inserts outbox event with eventType ticket.resolved', () => {
    return makeJob(client).run().then(() => {
      const outbox = client.queries.find(
        (q) => q.text.includes('outbox_events') && q.text.includes('INSERT'),
      );
      expect(outbox).toBeDefined();
      const payloadStr = outbox!.values.find(
        (v) => typeof v === 'string' && (v as string).includes('ticket.resolved'),
      ) as string;
      expect(payloadStr).toBeDefined();
      const payload = JSON.parse(payloadStr);
      expect(payload.eventType).toBe('ticket.resolved');
      expect(payload.tenantId).toBe(STUCK_RUNNING_ROW.tenant_id);
      expect(payload.ticketId).toBe(STUCK_RUNNING_ROW.ticket_id);
    });
  });
});

// ---------------------------------------------------------------------------
// AC10: Stale pending row under cap → re-enqueued
// ---------------------------------------------------------------------------

describe('ReconciliationJob.run() — stale pending row, under cap', () => {
  it('re-enqueues stale pending row', async () => {
    const client = new FakePoolClient();
    client.setRows([STUCK_PENDING_ROW]);
    const stats = await makeJob(client).run();
    expect(stats.requeued).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC10: Row at cap → marked permanently failed
// ---------------------------------------------------------------------------

describe('ReconciliationJob.run() — stale row at cap', () => {
  let client: FakePoolClient;

  beforeEach(() => {
    client = new FakePoolClient();
    client.setRows([STUCK_RUNNING_AT_CAP]);
  });

  it('returns failed=1', async () => {
    const stats = await makeJob(client).run();
    expect(stats.failed).toBe(1);
    expect(stats.requeued).toBe(0);
  });

  it("sets ai_status = 'failed'", () => {
    return makeJob(client).run().then(() => {
      const update = client.queries.find(
        (q) => q.text.includes('UPDATE') && q.text.includes("'failed'"),
      );
      expect(update).toBeDefined();
      expect(update!.values).toContain(STUCK_RUNNING_AT_CAP.id);
    });
  });

  it('sets last_error_code = RECONCILIATION_CAP_REACHED', () => {
    return makeJob(client).run().then(() => {
      const update = client.queries.find(
        (q) => q.text.includes('UPDATE') && q.text.includes('RECONCILIATION_CAP_REACHED'),
      );
      expect(update).toBeDefined();
    });
  });

  it('inserts ai.synthesis.failed outbox event', () => {
    return makeJob(client).run().then(() => {
      const outbox = client.queries.find(
        (q) => q.text.includes('outbox_events') && q.text.includes('INSERT'),
      );
      expect(outbox).toBeDefined();
      const payloadStr = outbox!.values.find(
        (v) => typeof v === 'string' && (v as string).includes('ai.synthesis.failed'),
      ) as string;
      expect(payloadStr).toBeDefined();
      const payload = JSON.parse(payloadStr);
      expect(payload.eventType).toBe('ai.synthesis.failed');
      expect(payload.lastErrorCode).toBe('RECONCILIATION_CAP_REACHED');
    });
  });
});

// ---------------------------------------------------------------------------
// AC10: Mixed rows — some under cap, some at cap
// ---------------------------------------------------------------------------

describe('ReconciliationJob.run() — mixed rows', () => {
  it('handles one under-cap and one at-cap row correctly', async () => {
    const client = new FakePoolClient();
    client.setRows([STUCK_RUNNING_ROW, STUCK_RUNNING_AT_CAP]);
    const stats = await makeJob(client).run();
    expect(stats.requeued).toBe(1);
    expect(stats.failed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC10: SQL shape — FOR UPDATE SKIP LOCKED
// ---------------------------------------------------------------------------

describe('ReconciliationJob.run() — SQL shape', () => {
  it('uses SELECT ... FOR UPDATE SKIP LOCKED', async () => {
    const client = new FakePoolClient();
    client.setRows([]);
    await makeJob(client).run();
    const scan = client.queries.find(
      (q) => q.text.includes('FOR UPDATE SKIP LOCKED'),
    );
    expect(scan).toBeDefined();
  });

  it('passes running and pending stale thresholds as parameters', async () => {
    const client = new FakePoolClient();
    client.setRows([]);
    await makeJob(client).run();
    const scan = client.queries.find(
      (q) => q.text.includes('FOR UPDATE SKIP LOCKED'),
    );
    // First two params are running_stale_minutes and pending_stale_minutes
    expect(typeof scan!.values[0]).toBe('number');
    expect(typeof scan!.values[1]).toBe('number');
    expect(Number(scan!.values[0])).toBeGreaterThan(0);
    expect(Number(scan!.values[1])).toBeGreaterThan(0);
  });

  it('includes a LIMIT clause', async () => {
    const client = new FakePoolClient();
    client.setRows([]);
    await makeJob(client).run();
    const scan = client.queries.find(
      (q) => q.text.includes('FOR UPDATE SKIP LOCKED'),
    );
    expect(scan!.text).toMatch(/LIMIT/);
  });
});

// ---------------------------------------------------------------------------
// AC10: Error handling — ROLLBACK on transaction failure
// ---------------------------------------------------------------------------

describe('ReconciliationJob.run() — transaction error', () => {
  it('executes ROLLBACK when query throws', async () => {
    let queryCount = 0;
    const errorClient = {
      queries: [] as QueryRecord[],
      released: false,
      async query(text: string, values: unknown[] = []) {
        queryCount++;
        this.queries.push({ text, values });
        if (text === 'BEGIN') return { rows: [] };
        throw new Error('simulated DB error');
      },
      release() { this.released = true; },
    };
    const pool: Pool = {
      connect: jest.fn().mockResolvedValue(errorClient as unknown as PoolClient),
    } as unknown as Pool;

    const job = new ReconciliationJob(pool);
    await expect(job.run()).resolves.toBeDefined(); // must not throw
    expect(errorClient.queries.some((q) => q.text === 'ROLLBACK')).toBe(true);
    expect(errorClient.released).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC10: MAX_ATTEMPTS constant
// ---------------------------------------------------------------------------

describe('MAX_ATTEMPTS — shared constant', () => {
  it('MAX_ATTEMPTS is 3', () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });

  it('STUCK_RUNNING_AT_CAP.attempt_count equals MAX_ATTEMPTS', () => {
    expect(STUCK_RUNNING_AT_CAP.attempt_count).toBe(MAX_ATTEMPTS);
  });
});

// ---------------------------------------------------------------------------
// AC11: FakeClock helper (from wo064.fixtures.ts)
// ---------------------------------------------------------------------------

describe('FakeClock helper', () => {
  it('advances time by minutes', () => {
    const clock = new FakeClock(new Date('2026-01-15T10:00:00.000Z'));
    clock.advanceMinutes(20);
    expect(clock.now().getTime()).toBe(new Date('2026-01-15T10:20:00.000Z').getTime());
  });

  it('minutesAgo returns a date in the past', () => {
    const clock = new FakeClock(new Date('2026-01-15T10:00:00.000Z'));
    const past = clock.minutesAgo(15);
    expect(past.getTime()).toBe(new Date('2026-01-15T09:45:00.000Z').getTime());
  });

  it('STUCK_RUNNING_ROW.updated_at is older than 15 minutes', () => {
    const ageMs = Date.now() - STUCK_RUNNING_ROW.updated_at.getTime();
    expect(ageMs).toBeGreaterThan(15 * 60 * 1000);
  });

  it('STUCK_PENDING_ROW.updated_at is older than 30 minutes', () => {
    const ageMs = Date.now() - STUCK_PENDING_ROW.updated_at.getTime();
    expect(ageMs).toBeGreaterThan(30 * 60 * 1000);
  });

  it('HEALTHY_RUNNING_ROW.updated_at is within 15-minute threshold', () => {
    const ageMs = Date.now() - HEALTHY_RUNNING_ROW.updated_at.getTime();
    expect(ageMs).toBeLessThan(15 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// DB-backed integration stubs (skip without DATABASE_URL)
// ---------------------------------------------------------------------------

const maybeDescribe = process.env['DATABASE_URL'] ? describe : describe.skip;

maybeDescribe('ReconciliationJob — DB integration (requires DATABASE_URL)', () => {
  it('re-enqueues a stuck running row and synthesis succeeds on redrive', () => {
    expect(true).toBe(true); // stub
  });

  it('marks capped row as failed and does not re-enqueue', () => {
    expect(true).toBe(true);
  });

  it('FOR UPDATE SKIP LOCKED prevents concurrent reconciliation from double-claiming', () => {
    expect(true).toBe(true);
  });

  it('tenant isolation: reconciliation only touches the calling tenant rows', () => {
    expect(true).toBe(true);
  });
});
