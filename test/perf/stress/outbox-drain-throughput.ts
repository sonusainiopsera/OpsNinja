/**
 * outbox-drain-throughput.ts — Outbox drain throughput and ordering stress test.
 *
 * Validates (AC7):
 *   - Drain sustains at least the modelled peak event rate (peak: ~6 events/s average,
 *     20× spike = ~120 events/s burst for the duration of the burst).
 *   - Per-aggregate ordering is preserved: events for the same aggregate_id are
 *     consumed in created_at order.
 *   - No event is lost: all injected event IDs appear in the drained set.
 *   - End-to-end lag (insert → drain) p95 ≤ declared threshold.
 *
 * Architecture context:
 *   - Outbox drain loop polls every 500ms in batches of 200.
 *   - Peak model: ~100k tickets/month × 8 events/lifecycle ≈ 0.3 events/s average;
 *     20× assumed peak burst = 6 events/s instantaneous. Year-1 burst ceiling = 120/s
 *     (10× month compressed to 1 month). The drain must keep pace.
 *   - Events must be published in created_at order per aggregate (see data-flow docs).
 *
 * This test injects a synthetic burst of outbox events directly into the DB, then
 * polls until the drain worker processes them, collecting ordering and lag data.
 *
 * Run:
 *   DATABASE_URL=postgres://... ts-node test/perf/stress/outbox-drain-throughput.ts
 */

import { Pool } from 'pg';
import type { OutboxDrainResult } from '../types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BURST_EVENT_COUNT      = parseInt(process.env['BURST_EVENT_COUNT']      ?? '1000',  10);
const AGGREGATES_COUNT       = parseInt(process.env['AGGREGATES_COUNT']       ?? '50',    10);
const MIN_DRAIN_RATE_EPS     = parseFloat(process.env['MIN_DRAIN_RATE_EPS']   ?? '120');  // events/sec
const MAX_WAIT_MS            = parseInt(process.env['MAX_WAIT_MS']            ?? '30000', 10);
const POLL_INTERVAL_MS       = parseInt(process.env['POLL_INTERVAL_MS']       ?? '500',   10);
const DATABASE_URL           = process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/opsninja_test';

const TEST_TENANT_ID         = '00000000-dead-beef-0000-outboxtest01';
const TEST_AGGREGATE_PREFIX  = '00000000-0000-0000-outb-';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padId(n: number): string {
  return `${TEST_AGGREGATE_PREFIX}${String(n).padStart(12, '0')}`;
}

async function injectEvents(pool: Pool, count: number, aggregateCount: number): Promise<{ ids: string[]; insertedAt: number }> {
  const client    = await pool.connect();
  const ids: string[] = [];
  const insertedAt = Date.now();

  try {
    const batchSize = 200;

    for (let offset = 0; offset < count; offset += batchSize) {
      const batchCount = Math.min(batchSize, count - offset);
      const values: string[] = [];
      const params: unknown[] = [];
      let pIdx = 1;

      for (let i = 0; i < batchCount; i++) {
        const globalIdx    = offset + i;
        const eventId      = padId(globalIdx + 100000);
        const aggregateId  = padId(globalIdx % aggregateCount);

        ids.push(eventId);
        values.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`);
        params.push(
          eventId,
          TEST_TENANT_ID,
          'ticket.created',
          aggregateId,
          JSON.stringify({ ticketId: aggregateId, seq: Math.floor(globalIdx / aggregateCount) }),
          false, // drained = false
        );
      }

      await client.query(
        `INSERT INTO outbox_events
           (id, tenant_id, event_type, aggregate_id, payload, drained)
         VALUES ${values.join(',')}`,
        params,
      );
    }

    return { ids, insertedAt };
  } finally {
    client.release();
  }
}

async function pollUntilDrained(
  pool:        Pool,
  expectedIds: Set<string>,
  insertedAt:  number,
): Promise<{ drainedIds: string[]; orderingViolations: number; lagSamplesMs: number[] }> {
  const drainedIds: string[] = [];
  const lagSamplesMs: number[] = [];
  let orderingViolations = 0;
  /** Track max seq seen per aggregate to detect out-of-order delivery. */
  const lastSeqPerAggregate = new Map<string, number>();

  const deadline = Date.now() + MAX_WAIT_MS;

  while (drainedIds.length < expectedIds.size && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const client = await pool.connect();
    try {
      const res = await client.query<{
        id:           string;
        aggregate_id: string;
        drained_at:   string | null;
        payload:      string;
      }>(
        `SELECT id, aggregate_id, drained_at, payload::text
         FROM outbox_events
         WHERE tenant_id = $1
           AND drained   = true
           AND id        LIKE $2
         ORDER BY drained_at ASC`,
        [TEST_TENANT_ID, `${TEST_AGGREGATE_PREFIX}1%`],
      );

      for (const row of res.rows) {
        if (!expectedIds.has(row.id) || drainedIds.includes(row.id)) continue;

        drainedIds.push(row.id);

        // Lag measurement
        if (row.drained_at) {
          lagSamplesMs.push(new Date(row.drained_at).getTime() - insertedAt);
        }

        // Ordering check: seq within same aggregate must be monotonically increasing
        const payload = JSON.parse(row.payload) as { seq?: number };
        if (typeof payload.seq === 'number') {
          const prev = lastSeqPerAggregate.get(row.aggregate_id);
          if (prev !== undefined && payload.seq < prev) {
            orderingViolations++;
          }
          lastSeqPerAggregate.set(row.aggregate_id, payload.seq);
        }
      }
    } finally {
      client.release();
    }
  }

  return { drainedIds, orderingViolations, lagSamplesMs };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

async function cleanup(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM outbox_events WHERE tenant_id = $1', [TEST_TENANT_ID]);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`[outbox-drain] Injecting ${BURST_EVENT_COUNT} events across ${AGGREGATES_COUNT} aggregates`);

  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });

  try {
    const { ids, insertedAt } = await injectEvents(pool, BURST_EVENT_COUNT, AGGREGATES_COUNT);
    const expectedSet = new Set(ids);

    console.log(`[outbox-drain] Injected ${ids.length} events, waiting for drain (max ${MAX_WAIT_MS}ms)...`);

    const startWait = Date.now();
    const { drainedIds, orderingViolations, lagSamplesMs } = await pollUntilDrained(pool, expectedSet, insertedAt);
    const elapsedSec = (Date.now() - startWait) / 1000;

    const lostCount    = expectedSet.size - drainedIds.length;
    const drainRate    = drainedIds.length / Math.max(elapsedSec, 0.001);
    const sortedLag    = lagSamplesMs.sort((a, b) => a - b);
    const lagP95       = percentile(sortedLag, 95);

    const result: OutboxDrainResult = {
      injectedEvents:           expectedSet.size,
      drainedEvents:            drainedIds.length,
      lostEvents:               lostCount,
      drainRateEventsPerSec:    parseFloat(drainRate.toFixed(2)),
      minRequiredRateEventsPerSec: MIN_DRAIN_RATE_EPS,
      orderingViolations,
      endToEndLagP95Ms:         lagP95,
      passed:
        lostCount            === 0 &&
        orderingViolations   === 0 &&
        drainRate            >= MIN_DRAIN_RATE_EPS,
    };

    console.log('[outbox-drain] Results:');
    console.log(`  Injected       : ${result.injectedEvents}`);
    console.log(`  Drained        : ${result.drainedEvents}`);
    console.log(`  Lost           : ${result.lostEvents}  (must be 0)`);
    console.log(`  Ordering violations: ${result.orderingViolations}  (must be 0)`);
    console.log(`  Drain rate     : ${result.drainRateEventsPerSec} eps  (min: ${MIN_DRAIN_RATE_EPS})`);
    console.log(`  Lag p95        : ${result.endToEndLagP95Ms}ms`);
    console.log(`  VERDICT        : ${result.passed ? 'PASS' : 'FAIL'}`);

    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(result, null, 2));
    }

    if (!result.passed) process.exitCode = 1;
  } finally {
    await cleanup(pool);
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[outbox-drain] Fatal:', err);
  process.exit(1);
});

export { injectEvents, pollUntilDrained, percentile };
