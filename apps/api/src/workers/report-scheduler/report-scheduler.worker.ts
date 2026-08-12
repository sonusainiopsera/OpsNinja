/**
 * ReportSchedulerWorker — durable 60-second tick for scheduled report dispatch (WO-075).
 *
 * Algorithm per tick:
 *   1. Claim up to CLAIM_BATCH_LIMIT due schedules with FOR UPDATE SKIP LOCKED in a
 *      short-lived transaction (commit immediately after SELECT to release locks).
 *   2. For each claimed schedule, open a per-tenant transaction:
 *        a. SET LOCAL app.current_tenant for RLS.
 *        b. INSERT report_schedule_occurrences ON CONFLICT DO NOTHING.
 *           → 0 rows = already dispatched (duplicate tick); increment counter, skip outbox.
 *           → 1 row = first claim; write report.schedule.fired outbox event.
 *        c. Recompute next_fire_at via IANA-aware cron calculator.
 *        d. UPDATE report_schedules next_fire_at + last_fired_at.
 *        e. COMMIT (atomic: occurrence + outbox + schedule advance share one txn).
 *   3. SIGTERM / SIGINT drain: stop the timer, finish the in-progress tick.
 *
 * The occurrence_key unique constraint is the idempotency gate — duplicate inserts
 * across concurrent scheduler pods or SQS redelivery are silently suppressed.
 *
 * Metrics emitted (structured log lines consumed by the OTEL log collector):
 *   scheduler_tick_duration_ms   — wall-clock time of the full tick
 *   scheduler_claim_batch_size   — schedules claimed this tick
 *   scheduler_duplicate_suppressed — occurrence conflicts (per-tick total)
 *   scheduler_dispatch_success   — occurrences written and enqueued
 *   scheduler_dispatch_error     — per-schedule errors (processing continues)
 */

import { Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import {
  computeNextFireAt,
  buildOccurrenceKey,
  CronParseError,
  CronIterationLimitError,
} from '../../modules/reporting/domain/cron-next-fire';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const CLAIM_BATCH_LIMIT = 200;
const TICK_INTERVAL_MS         = 60_000;

// ---------------------------------------------------------------------------
// Minimal schedule row interface (mirrors report_schedules table)
// ---------------------------------------------------------------------------

export interface ClaimableSchedule {
  id:                   string;
  tenantId:             string;
  reportDefinitionId:   string;
  cronExpression:       string;
  timezone:             string;
  format:               string;
  recipients:           unknown;
  nextFireAt:           Date;
}

// ---------------------------------------------------------------------------
// Ports for testability
// ---------------------------------------------------------------------------

export interface ClockFn {
  (): Date;
}

export interface MetricEmitter {
  emit(name: string, value: number, tags?: Record<string, string>): void;
}

const noopMetrics: MetricEmitter = { emit: () => undefined };

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export class ReportSchedulerWorker {
  private readonly logger = new Logger(ReportSchedulerWorker.name);
  private tickHandle: ReturnType<typeof setTimeout> | null = null;
  private draining    = false;
  private ready       = false;

  constructor(
    private readonly pool:    Pool,
    private readonly clock:   ClockFn     = () => new Date(),
    private readonly metrics: MetricEmitter = noopMetrics,
  ) {}

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  start(): void {
    this.logger.log('Report scheduler starting — first tick in 1 s');
    this.tickHandle = setTimeout(() => this.runTick(), 1_000);
  }

  async stop(): Promise<void> {
    this.draining = true;
    if (this.tickHandle) {
      clearTimeout(this.tickHandle);
      this.tickHandle = null;
    }
    this.logger.log('Report scheduler stopped');
  }

  isReady(): boolean {
    return this.ready;
  }

  // --------------------------------------------------------------------------
  // Tick
  // --------------------------------------------------------------------------

  private scheduleNextTick(): void {
    if (!this.draining) {
      this.tickHandle = setTimeout(() => this.runTick(), TICK_INTERVAL_MS);
    }
  }

  private async runTick(): Promise<void> {
    const tickStart = this.clock().getTime();

    let schedules: ClaimableSchedule[] = [];
    try {
      schedules = await this.claimDueSchedules();
    } catch (err) {
      this.logger.error('Claim query failed — skipping tick', {
        error: (err as Error).message,
      });
      this.scheduleNextTick();
      return;
    }

    this.metrics.emit('scheduler_claim_batch_size', schedules.length);

    let duplicates     = 0;
    let dispatchedOk   = 0;
    let dispatchErrors = 0;

    for (const schedule of schedules) {
      const result = await this.processSchedule(schedule);
      if (result === 'duplicate')  duplicates++;
      else if (result === 'ok')    dispatchedOk++;
      else                         dispatchErrors++;
    }

    const tickDurationMs = this.clock().getTime() - tickStart;
    this.metrics.emit('scheduler_tick_duration_ms',     tickDurationMs);
    this.metrics.emit('scheduler_duplicate_suppressed', duplicates);
    this.metrics.emit('scheduler_dispatch_success',     dispatchedOk);
    this.metrics.emit('scheduler_dispatch_error',       dispatchErrors);

    this.logger.log('Tick complete', {
      claimedCount: schedules.length,
      duplicates,
      dispatchedOk,
      dispatchErrors,
      tickDurationMs,
    });

    this.ready = true;
    this.scheduleNextTick();
  }

  // --------------------------------------------------------------------------
  // Claim due schedules (short-lived claim transaction released immediately)
  // --------------------------------------------------------------------------

  async claimDueSchedules(): Promise<ClaimableSchedule[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<ClaimableSchedule>(`
        SELECT
          id,
          tenant_id            AS "tenantId",
          report_definition_id AS "reportDefinitionId",
          cron_expression      AS "cronExpression",
          timezone,
          format,
          recipients,
          next_fire_at         AS "nextFireAt"
        FROM report_schedules
        WHERE enabled = true
          AND next_fire_at <= now()
        ORDER BY next_fire_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `, [CLAIM_BATCH_LIMIT]);
      await client.query('COMMIT');
      return rows;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  // --------------------------------------------------------------------------
  // Per-schedule processing (one tenant-scoped transaction)
  // --------------------------------------------------------------------------

  async processSchedule(
    schedule: ClaimableSchedule,
  ): Promise<'ok' | 'duplicate' | 'error'> {
    const { id, tenantId, cronExpression, timezone, nextFireAt } = schedule;
    const occurrenceKey = buildOccurrenceKey(tenantId, id, nextFireAt);

    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // RLS: all queries below run with tenant context.
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      // Idempotency gate: ON CONFLICT DO NOTHING on occurrence_key unique index.
      const { rows: occRows } = await client.query<{ id: string }>(`
        INSERT INTO report_schedule_occurrences
          (id, tenant_id, schedule_id, fire_at, occurrence_key, status, attempts)
        VALUES ($1, $2, $3, $4, $5, 'pending', 0)
        ON CONFLICT (occurrence_key) DO NOTHING
        RETURNING id
      `, [randomUUID(), tenantId, id, nextFireAt, occurrenceKey]);

      if (occRows.length === 0) {
        // Already dispatched — suppress duplicate.
        await this.advanceSchedule(client, schedule, nextFireAt);
        await client.query('COMMIT');
        this.logger.warn('Duplicate occurrence suppressed', {
          tenantId, scheduleId: id, occurrenceKey,
        });
        return 'duplicate';
      }

      // Write outbox event (shares the same transaction as the occurrence insert).
      await client.query(`
        INSERT INTO outbox_events (id, tenant_id, event_type, payload, created_at)
        VALUES ($1, $2, 'report.schedule.fired', $3::jsonb, now())
      `, [
        randomUUID(),
        tenantId,
        JSON.stringify({
          tenantId,
          scheduleId:          id,
          reportDefinitionId:  schedule.reportDefinitionId,
          occurrenceKey,
          fireAt:              nextFireAt.toISOString(),
          format:              schedule.format,
          recipients:          schedule.recipients,
        }),
      ]);

      await this.advanceSchedule(client, schedule, nextFireAt);
      await client.query('COMMIT');

      this.logger.log('Schedule dispatched', {
        tenantId, scheduleId: id, occurrenceKey,
      });
      return 'ok';

    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.logger.error('Failed to process schedule', {
        tenantId, scheduleId: id, error: (err as Error).message,
      });
      return 'error';
    } finally {
      client.release();
    }
  }

  // --------------------------------------------------------------------------
  // Advance next_fire_at (called inside the open tenant transaction)
  // --------------------------------------------------------------------------

  private async advanceSchedule(
    client: PoolClient,
    schedule: ClaimableSchedule,
    lastFiredAt: Date,
  ): Promise<void> {
    let nextFireAt: Date | null = null;

    try {
      const { nextUtc } = computeNextFireAt({
        expression: schedule.cronExpression,
        timezone:   schedule.timezone,
        after:      lastFiredAt,
      });
      nextFireAt = nextUtc;
    } catch (err) {
      if (err instanceof CronParseError || err instanceof CronIterationLimitError) {
        // Broken expression — disable the schedule to prevent repeated failures.
        this.logger.error('Cannot compute next_fire_at — disabling schedule', {
          tenantId:  schedule.tenantId,
          scheduleId: schedule.id,
          error:     (err as Error).message,
        });
        await client.query(`
          UPDATE report_schedules
          SET enabled = false, next_fire_at = null, updated_at = now()
          WHERE id = $1
        `, [schedule.id]);
        return;
      }
      throw err;
    }

    await client.query(`
      UPDATE report_schedules
      SET next_fire_at = $1, last_fired_at = $2, updated_at = now()
      WHERE id = $3
    `, [nextFireAt, lastFiredAt, schedule.id]);
  }
}
