/**
 * sla-scheduler-contention.ts — SLA timer scheduler contention stress test.
 *
 * Validates (AC6):
 *   - No timer is claimed twice (exactly-once semantics via FOR UPDATE SKIP LOCKED)
 *   - No timer is skipped (all due timers within the batch window are processed)
 *   - Tick duration stays within one tick interval at the declared active-timer volume
 *
 * Approach:
 *   1. Pre-populate a batch of synthetic SLA timers (all due at the same instant).
 *   2. Launch N concurrent scheduler processes (simulated as concurrent async tasks).
 *   3. Each process runs a tick: SELECT ... FOR UPDATE SKIP LOCKED + UPDATE claimed=true.
 *   4. Reconcile: collect all claimed timer IDs, assert:
 *       - No ID appears more than once (no double-claim)
 *       - All injected timer IDs were claimed (no skip)
 *       - Max tick duration ≤ TICK_INTERVAL_MS
 *
 * This is a Node.js script using a real Postgres connection (reads DATABASE_URL).
 * It operates inside an isolated schema/tenant and cleans up after itself.
 *
 * Run:
 *   DATABASE_URL=postgres://... ts-node test/perf/stress/sla-scheduler-contention.ts
 */

import { Pool } from 'pg';
import type { SchedulerContentionResult } from '../types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const SCHEDULER_COUNT   = parseInt(process.env['SCHEDULER_COUNT']   ?? '4',       10);
const ACTIVE_TIMER_COUNT = parseInt(process.env['ACTIVE_TIMER_COUNT'] ?? '10000', 10);
const TICK_INTERVAL_MS  = parseInt(process.env['TICK_INTERVAL_MS']  ?? '15000',  10); // 15s
const BATCH_SIZE        = parseInt(process.env['BATCH_SIZE']         ?? '500',   10);
const DATABASE_URL      = process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/opsninja_test';

/** Isolated tenant ID for this test run — avoids cross-tenant interference. */
const TEST_TENANT_ID = '00000000-dead-beef-0000-contention01';

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

async function setupTimers(pool: Pool, count: number): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create test timers (all due immediately)
    const ids: string[] = [];
    const batchSz = 500;

    for (let offset = 0; offset < count; offset += batchSz) {
      const batchCount = Math.min(batchSz, count - offset);
      const values: string[] = [];
      const params: unknown[] = [];
      let pIdx = 1;

      for (let i = 0; i < batchCount; i++) {
        const id = `00000000-0000-0000-${String(offset + i).padStart(4, '0')}-${String(offset + i).padStart(12, '0')}`;
        ids.push(id);
        values.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`);
        params.push(id, TEST_TENANT_ID, 'test-ticket-id', now_minus_seconds(5), false);
      }

      await client.query(
        `INSERT INTO sla_timers
           (id, tenant_id, ticket_id, next_fire_at, claimed)
         VALUES ${values.join(',')}
         ON CONFLICT (id) DO NOTHING`,
        params,
      );
    }

    await client.query('COMMIT');
    return ids;
  } finally {
    client.release();
  }
}

async function cleanupTimers(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      'DELETE FROM sla_timers WHERE tenant_id = $1',
      [TEST_TENANT_ID],
    );
  } finally {
    client.release();
  }
}

function now_minus_seconds(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Simulated scheduler tick
// ---------------------------------------------------------------------------
interface TickResult {
  schedulerIndex:  number;
  claimedIds:      string[];
  durationMs:      number;
}

async function runSchedulerTick(pool: Pool, schedulerIndex: number): Promise<TickResult> {
  const client = await pool.connect();
  const start  = Date.now();
  const claimed: string[] = [];

  try {
    let hasMore = true;

    while (hasMore) {
      await client.query('BEGIN');

      const res = await client.query<{ id: string }>(
        `SELECT id
         FROM sla_timers
         WHERE tenant_id   = $1
           AND claimed     = false
           AND next_fire_at <= now()
         ORDER BY next_fire_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [TEST_TENANT_ID, BATCH_SIZE],
      );

      if (res.rows.length === 0) {
        await client.query('ROLLBACK');
        hasMore = false;
        continue;
      }

      const ids = res.rows.map((r) => r.id);
      await client.query(
        `UPDATE sla_timers
         SET claimed = true, claimed_by = $1
         WHERE id = ANY($2::uuid[])`,
        [`scheduler-${schedulerIndex}`, ids],
      );

      await client.query('COMMIT');
      claimed.push(...ids);

      // Stop after one batch for this stress test; production ticks are bounded
      hasMore = false;
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return {
    schedulerIndex,
    claimedIds: claimed,
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------
function reconcile(
  allTickResults: TickResult[],
  expectedIds:    Set<string>,
): { duplicates: string[]; skipped: string[]; maxTickMs: number } {
  const seen      = new Map<string, number>(); // id → scheduler index of first claim
  const duplicates: string[] = [];
  let maxTickMs   = 0;

  for (const tick of allTickResults) {
    maxTickMs = Math.max(maxTickMs, tick.durationMs);

    for (const id of tick.claimedIds) {
      if (seen.has(id)) {
        duplicates.push(id);
      } else {
        seen.set(id, tick.schedulerIndex);
      }
    }
  }

  const skipped = [...expectedIds].filter((id) => !seen.has(id));

  return { duplicates, skipped, maxTickMs };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`[sla-contention] Starting with ${SCHEDULER_COUNT} schedulers, ${ACTIVE_TIMER_COUNT} timers`);

  const pool = new Pool({ connectionString: DATABASE_URL, max: SCHEDULER_COUNT + 2 });

  let timerIds: string[] = [];
  try {
    timerIds = await setupTimers(pool, ACTIVE_TIMER_COUNT);
    console.log(`[sla-contention] Seeded ${timerIds.length} due timers`);

    // Launch N concurrent scheduler ticks
    const tickPromises = Array.from({ length: SCHEDULER_COUNT }, (_, i) =>
      runSchedulerTick(pool, i),
    );

    const tickResults = await Promise.all(tickPromises);

    // Reconcile
    const expectedSet = new Set(timerIds);
    const { duplicates, skipped, maxTickMs } = reconcile(tickResults, expectedSet);

    const result: SchedulerContentionResult = {
      schedulerCount:      SCHEDULER_COUNT,
      activeTimerCount:    ACTIVE_TIMER_COUNT,
      duplicateClaims:     duplicates.length,
      skippedTimers:       skipped.length,
      maxTickDurationMs:   maxTickMs,
      tickDurationLimitMs: TICK_INTERVAL_MS,
      passed:
        duplicates.length === 0 &&
        skipped.length    === 0 &&
        maxTickMs         <= TICK_INTERVAL_MS,
    };

    console.log('[sla-contention] Results:');
    console.log(`  Duplicate claims : ${result.duplicateClaims}  (must be 0)`);
    console.log(`  Skipped timers   : ${result.skippedTimers}   (must be 0)`);
    console.log(`  Max tick duration: ${result.maxTickDurationMs}ms (limit: ${result.tickDurationLimitMs}ms)`);
    console.log(`  VERDICT          : ${result.passed ? 'PASS' : 'FAIL'}`);

    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(result, null, 2));
    }

    if (!result.passed) {
      if (duplicates.length > 0) {
        console.error(`[sla-contention] FAIL: ${duplicates.length} duplicate claims detected`);
        console.error('  First 5:', duplicates.slice(0, 5));
      }
      if (skipped.length > 0) {
        console.error(`[sla-contention] FAIL: ${skipped.length} timers were not claimed`);
      }
      if (maxTickMs > TICK_INTERVAL_MS) {
        console.error(`[sla-contention] FAIL: max tick ${maxTickMs}ms exceeds interval ${TICK_INTERVAL_MS}ms`);
      }
      process.exitCode = 1;
    } else {
      console.log('[sla-contention] All assertions PASSED');
    }
  } finally {
    await cleanupTimers(pool);
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[sla-contention] Fatal error:', err);
  process.exit(1);
});

export { reconcile, runSchedulerTick };
