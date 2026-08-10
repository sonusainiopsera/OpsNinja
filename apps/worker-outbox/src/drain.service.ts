/**
 * Outbox drain service.
 *
 * Polls `outbox_events` every `intervalMs` (default 500ms), selects pending
 * rows using FOR UPDATE SKIP LOCKED so concurrent instances don't duplicate
 * work, publishes through the `PublisherPort`, and marks rows as published
 * or increments the backoff counter on failure.
 *
 * Key design decisions:
 *   - FOR UPDATE SKIP LOCKED: other drain instances skip locked rows, giving
 *     concurrency-safe exactly-once-in-flight semantics (combined with the
 *     published_at check, this achieves at-most-once-active-delivery).
 *   - Per-aggregate ordering: ORDER BY created_at, outbox_seq within each
 *     tenant keeps events for the same entity in causal order.
 *   - Transaction budget: the publish call happens INSIDE the transaction.
 *     For the in-memory adapter this is instant; the production bus adapter
 *     must complete within the configured statement_timeout (default 5s).
 *     This is a known trade-off documented in the architecture: if the bus is
 *     slow the transaction stays open, but SKIP LOCKED means other rows are
 *     unaffected.
 *   - Failure isolation: publish errors are caught per-row and never abort
 *     the whole batch. Other rows in the batch continue.
 */

import postgres from 'postgres';
import type { PublisherPort, DomainEvent } from '@opsninja/shared/messaging';
import { nextAttemptAt, shouldDeadLetter } from './backoff.js';
import { metrics } from './metrics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OutboxRow {
  tenant_id: string;
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
  attempts: number;
  outbox_seq: number;
}

export interface DrainServiceOptions {
  connectionString: string;
  publisher: PublisherPort;
  intervalMs?: number;
  batchSize?: number;
  /** Statement timeout for the drain transaction, in milliseconds. */
  txBudgetMs?: number;
}

// ---------------------------------------------------------------------------
// DrainService
// ---------------------------------------------------------------------------

export class DrainService {
  private readonly sql: postgres.Sql;
  private readonly publisher: PublisherPort;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly txBudgetMs: number;

  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: DrainServiceOptions) {
    this.sql = postgres(opts.connectionString, {
      max: 3,
      idle_timeout: 30,
      connect_timeout: 10,
    });
    this.publisher = opts.publisher;
    this.intervalMs = opts.intervalMs ?? 500;
    this.batchSize = opts.batchSize ?? 200;
    this.txBudgetMs = opts.txBudgetMs ?? 5_000;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'outbox.drain.started',
        publisher: this.publisher.name,
        intervalMs: this.intervalMs,
        batchSize: this.batchSize,
      }),
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.sql.end();
    console.log(JSON.stringify({ level: 'info', msg: 'outbox.drain.stopped' }));
  }

  // -------------------------------------------------------------------------
  // Drain loop
  // -------------------------------------------------------------------------

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      try {
        await this.runOnce();
      } catch (err) {
        console.error(
          JSON.stringify({ level: 'error', msg: 'outbox.drain.unhandled_error', err: String(err) }),
        );
      } finally {
        this.scheduleNext();
      }
    }, this.intervalMs);
  }

  /**
   * Run a single drain iteration.
   * Public for testing (allows direct invocation without the timer).
   */
  async runOnce(now: Date = new Date()): Promise<DrainResult> {
    const startMs = metrics.recordDrainStart();
    const result: DrainResult = { processed: 0, published: 0, failed: 0, deadLettered: 0 };

    await this.sql.begin(async (tx) => {
      // Set a statement timeout to bound the transaction open time.
      await tx`SET LOCAL statement_timeout = ${String(this.txBudgetMs)}`;

      // Select the next batch with FOR UPDATE SKIP LOCKED.
      // ORDER BY created_at, outbox_seq preserves per-aggregate causal order.
      const rows = await tx<OutboxRow[]>`
        SELECT
          tenant_id, id, aggregate_type, aggregate_id,
          event_type, payload, created_at, attempts, outbox_seq
        FROM outbox_events
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
        ORDER BY created_at, outbox_seq
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) {
        return;
      }

      result.processed = rows.length;

      // Process each row — failures are isolated per row.
      const publishedIds: string[] = [];
      const failedRows: Array<{ id: string; tenantId: string; attempts: number }> = [];

      for (const row of rows) {
        const event: DomainEvent = {
          id: row.id,
          tenantId: row.tenant_id,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          eventType: row.event_type,
          payload: row.payload,
          occurredAt: row.created_at,
        };

        try {
          await this.publisher.publish(event);
          publishedIds.push(row.id);
          result.published++;
        } catch (err) {
          console.error(
            JSON.stringify({
              level: 'error',
              msg: 'outbox.publish.failed',
              eventId: row.id,
              aggregateType: row.aggregate_type,
              aggregateId: row.aggregate_id,
              attempts: row.attempts + 1,
              err: String(err),
            }),
          );
          failedRows.push({ id: row.id, tenantId: row.tenant_id, attempts: row.attempts + 1 });
          result.failed++;
        }
      }

      // Mark successful rows as published.
      if (publishedIds.length > 0) {
        await tx`
          UPDATE outbox_events
          SET status = 'published',
              published_at = ${now},
              attempts = attempts + 1
          WHERE id = ANY(${publishedIds}::uuid[])
            AND tenant_id = ANY(
              SELECT DISTINCT tenant_id FROM outbox_events
              WHERE id = ANY(${publishedIds}::uuid[])
            )
        `;
        metrics.recordPublishSuccess(publishedIds.length);
      }

      // Handle failed rows with backoff or dead-letter.
      for (const failed of failedRows) {
        if (shouldDeadLetter(failed.attempts)) {
          await tx`
            UPDATE outbox_events
            SET status = 'dead_letter',
                attempts = ${failed.attempts}
            WHERE id = ${failed.id}::uuid
          `;
          result.deadLettered++;
          metrics.recordPublishFailure();
          console.error(
            JSON.stringify({
              level: 'error',
              msg: 'outbox.dead_letter',
              eventId: failed.id,
              attempts: failed.attempts,
              alert: true,
            }),
          );
        } else {
          const nextAttempt = nextAttemptAt(failed.attempts, now);
          await tx`
            UPDATE outbox_events
            SET attempts = ${failed.attempts},
                next_attempt_at = ${nextAttempt}
            WHERE id = ${failed.id}::uuid
          `;
          metrics.recordPublishFailure();
        }
      }
    });

    // Collect aggregate metrics for this iteration.
    const { pendingCount, oldestUnpublishedSeconds, deadLetterCount } =
      await this.collectAggregateMetrics();
    metrics.recordDrainEnd(startMs, pendingCount, oldestUnpublishedSeconds, deadLetterCount);

    if (result.processed > 0) {
      console.log(
        JSON.stringify({
          level: 'info',
          msg: 'outbox.drain.iteration',
          ...result,
          durationMs: Date.now() - startMs,
          publisher: this.publisher.name,
        }),
      );
    }

    return result;
  }

  /**
   * Replay a dead-lettered event by resetting it to pending status.
   * Operator command — requires explicit invocation, not called by the drain loop.
   */
  async replay(eventId: string): Promise<void> {
    const rows = await this.sql`
      UPDATE outbox_events
      SET status = 'pending',
          attempts = 0,
          next_attempt_at = NULL
      WHERE id = ${eventId}::uuid
        AND status = 'dead_letter'
      RETURNING id
    `;
    if (rows.length === 0) {
      throw new Error(`Event ${eventId} not found or not in dead_letter status`);
    }
    console.log(JSON.stringify({ level: 'info', msg: 'outbox.replay', eventId }));
  }

  // -------------------------------------------------------------------------
  // Metrics helpers
  // -------------------------------------------------------------------------

  private async collectAggregateMetrics(): Promise<{
    pendingCount: number;
    oldestUnpublishedSeconds: number;
    deadLetterCount: number;
  }> {
    try {
      const rows = await this.sql<[{ pending_count: number; oldest_seconds: number; dead_letter_count: number }]>`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::int               AS pending_count,
          COALESCE(
            EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'pending')))::int,
            0
          )                                                              AS oldest_seconds,
          COUNT(*) FILTER (WHERE status = 'dead_letter')::int           AS dead_letter_count
        FROM outbox_events
      `;
      const row = rows[0];
      return {
        pendingCount: row?.pending_count ?? 0,
        oldestUnpublishedSeconds: row?.oldest_seconds ?? 0,
        deadLetterCount: row?.dead_letter_count ?? 0,
      };
    } catch {
      return { pendingCount: 0, oldestUnpublishedSeconds: 0, deadLetterCount: 0 };
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DrainResult {
  processed: number;
  published: number;
  failed: number;
  deadLettered: number;
}
