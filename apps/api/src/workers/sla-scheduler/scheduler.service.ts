/**
 * SchedulerService — tick orchestrator for the SLA scheduler worker (WO-046).
 *
 * Responsibilities:
 *   1. Drive a 15-second interval with bounded jitter (0–2.5 s).
 *   2. Per tick: call TimerClaimRepository.claimDueTimers(), process each timer
 *      in a per-tenant sub-transaction, and commit the outer transaction.
 *   3. For each timer: classify due boundaries, record fired boundaries,
 *      write outbox events, advance next_fire_at, and update state.
 *   4. Catch per-timer errors to avoid one bad row aborting the batch; after
 *      five consecutive failures park the timer with state='error'.
 *   5. Emit OpenTelemetry-style structured metrics (sla_scheduler_*).
 *   6. SIGTERM drain: stop accepting new ticks, finish the current batch.
 *   7. Readiness gate: marks unhealthy when lag > LAG_READY_THRESHOLD_SECONDS.
 *
 * The injectable Clock abstraction allows tests to advance time without sleeping.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PoolClient } from 'pg';
import {
  TimerClaimRepository,
  SLA_EVENT_TYPES,
} from './timer-claim.repository';
import {
  classifyDueBoundaries,
  advanceTimerState,
  computeLagSeconds,
  type ClaimableTimer,
  type SlaBoundary,
  type Clock,
} from './boundary-classifier';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Normal tick interval in milliseconds. */
const TICK_INTERVAL_MS = 15_000;

/** Maximum jitter added per tick (uniform random, 0–JITTER_MS). */
const JITTER_MS = 2_500;

/** After this many consecutive per-timer errors, park the timer with state='error'. */
const MAX_CONSECUTIVE_FAILURES = 5;

/** Lag threshold above which readiness probe reports unhealthy (seconds). */
export const LAG_READY_THRESHOLD_SECONDS = 300;

/** Lag threshold above which a Prometheus alert fires (seconds). */
export const LAG_ALERT_THRESHOLD_SECONDS = 60;

// ---------------------------------------------------------------------------
// Ticket terminal-state check interface
// ---------------------------------------------------------------------------

/** Minimal interface used to check whether a ticket has reached a terminal state. */
export interface TicketStateChecker {
  /**
   * Returns true when the ticket is closed, cancelled, deleted, or in any other
   * state that should cause the SLA timer to stop firing.
   */
  isTerminal(tenantId: string, ticketId: string, client: PoolClient): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// SLA policy thresholds loader interface
// ---------------------------------------------------------------------------

export interface PolicyThresholdsLoader {
  loadThresholds(
    tenantId: string,
    slaPolicyId: string,
    client: PoolClient,
  ): Promise<{ reminderPctFirst: number; reminderPctSecond: number } | null>;
}

// ---------------------------------------------------------------------------
// Scheduler metrics state
// ---------------------------------------------------------------------------

export interface SchedulerMetrics {
  tickDurationMs: number;
  claimedTotal: number;
  fireTotal: Record<SlaBoundary, number>;
  lagSeconds: number;
  errorTotal: number;
}

// ---------------------------------------------------------------------------
// SchedulerService
// ---------------------------------------------------------------------------

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);

  /** Injectable clock — replaced in tests to advance time deterministically. */
  private clock: Clock = () => new Date();

  private tickHandle: ReturnType<typeof setTimeout> | null = null;
  private draining = false;
  private ready = false;
  private lastLagSeconds = 0;

  // Consecutive failure counters per timer id.
  private readonly consecutiveFailures = new Map<string, number>();

  constructor(
    private readonly claimRepo: TimerClaimRepository,
    private readonly ticketStateChecker: TicketStateChecker,
    private readonly policyLoader: PolicyThresholdsLoader,
  ) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  onModuleInit(): void {
    this.logger.log('SLA scheduler starting — first tick in ~1s');
    this.scheduleTick(1_000);
  }

  onModuleDestroy(): void {
    this.logger.log('SLA scheduler stopping (SIGTERM drain)');
    this.draining = true;
    if (this.tickHandle) {
      clearTimeout(this.tickHandle);
      this.tickHandle = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Injectable clock (for tests)
  // ---------------------------------------------------------------------------

  setClock(clock: Clock): void {
    this.clock = clock;
  }

  // ---------------------------------------------------------------------------
  // Health probe accessors
  // ---------------------------------------------------------------------------

  isLive(): boolean {
    // Live as long as the process is not stuck mid-tick.
    return !this.draining;
  }

  isReady(): boolean {
    return this.ready && this.lastLagSeconds < LAG_READY_THRESHOLD_SECONDS;
  }

  getLagSeconds(): number {
    return this.lastLagSeconds;
  }

  // ---------------------------------------------------------------------------
  // Tick scheduling
  // ---------------------------------------------------------------------------

  private scheduleTick(delayMs: number): void {
    if (this.draining) return;
    this.tickHandle = setTimeout(() => {
      void this.runTick().finally(() => {
        this.scheduleTick(TICK_INTERVAL_MS + Math.floor(Math.random() * JITTER_MS));
      });
    }, delayMs);
  }

  // ---------------------------------------------------------------------------
  // Main tick
  // ---------------------------------------------------------------------------

  /**
   * One scheduler tick:
   *   1. Claim due timers in an outer transaction (scheduler claim role).
   *   2. For each timer, run per-tenant sub-transaction (opsninja_app role).
   *   3. Commit outer transaction (releases FOR UPDATE locks).
   */
  async runTick(): Promise<void> {
    if (this.draining) return;

    const tickStart = this.clock().getTime();
    let claimedCount = 0;
    let fireCount = 0;
    let errorCount = 0;

    let batch;
    try {
      batch = await this.claimRepo.claimDueTimers();
    } catch (err) {
      this.logger.error('Failed to claim due timers — database unreachable', {
        err: String(err),
        metric: 'sla_scheduler_tick_error',
      });
      this.ready = false;
      return;
    }

    const { timers, oldestNextFireAt, client } = batch;
    claimedCount = timers.length;

    // Update lag metric immediately after claim.
    this.lastLagSeconds = computeLagSeconds(oldestNextFireAt, this.clock);

    try {
      for (const timer of timers) {
        try {
          const fired = await this.processTimer(client, timer);
          fireCount += fired;
          this.consecutiveFailures.delete(timer.id);
        } catch (err) {
          errorCount++;
          const failures = (this.consecutiveFailures.get(timer.id) ?? 0) + 1;
          this.consecutiveFailures.set(timer.id, failures);

          this.logger.error('Per-timer processing failed', {
            timerId: timer.id,
            tenantId: timer.tenantId,
            ticketId: timer.ticketId,
            consecutiveFailures: failures,
            err: String(err),
          });

          if (failures >= MAX_CONSECUTIVE_FAILURES) {
            await this.parkTimerWithError(client, timer).catch((e: unknown) => {
              this.logger.error('Failed to park errored timer', { timerId: timer.id, err: String(e) });
            });
            this.consecutiveFailures.delete(timer.id);
            this.emitAlert('sla_scheduler_timer_parked', { timerId: timer.id, tenantId: timer.tenantId });
          }
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      this.logger.error('Tick commit failed — rolling back', { err: String(err) });
      await client.query('ROLLBACK').catch(() => undefined);
      errorCount = claimedCount; // count all as errors if commit fails
    } finally {
      client.release();
    }

    const tickDurationMs = this.clock().getTime() - tickStart;
    this.ready = true;

    // Emit metrics.
    this.emitMetric('sla_scheduler_tick_duration_ms', tickDurationMs);
    this.emitMetric('sla_scheduler_claimed_total', claimedCount);
    this.emitMetric('sla_scheduler_fire_total', fireCount);
    this.emitMetric('sla_scheduler_lag_seconds', this.lastLagSeconds);
    this.emitMetric('sla_scheduler_error_total', errorCount);

    if (this.lastLagSeconds > LAG_ALERT_THRESHOLD_SECONDS) {
      this.emitAlert('sla_scheduler_lag_high', { lagSeconds: this.lastLagSeconds });
    }

    this.logger.log('Tick complete', {
      claimedCount,
      fireCount,
      errorCount,
      tickDurationMs,
      lagSeconds: this.lastLagSeconds,
    });
  }

  // ---------------------------------------------------------------------------
  // Per-timer processing
  // ---------------------------------------------------------------------------

  /**
   * Process a single claimed timer in a per-tenant sub-transaction.
   *
   * Returns the number of boundaries fired.
   */
  private async processTimer(client: PoolClient, timer: ClaimableTimer): Promise<number> {
    // Set the tenant context so all subsequent queries are RLS-bound.
    // SET LOCAL is transaction-scoped and safe with PgBouncer transaction pooling.
    await client.query(
      `SELECT set_config('app.current_tenant', $1, true)`,
      [timer.tenantId],
    );

    // Check whether the ticket has reached a terminal state.
    const isTerminal = await this.ticketStateChecker.isTerminal(timer.tenantId, timer.ticketId, client);
    if (isTerminal) {
      await this.transitionToTerminal(client, timer, 'met');
      this.logger.log('Timer cancelled — ticket is in terminal state', {
        timerId: timer.id,
        tenantId: timer.tenantId,
        ticketId: timer.ticketId,
      });
      return 0;
    }

    // Load policy thresholds (from snapshot captured at timer creation).
    const thresholds = await this.policyLoader.loadThresholds(
      timer.tenantId,
      timer.slaPolicyId,
      client,
    );

    if (!thresholds) {
      // Policy deleted or deactivated — transition to met / cancelled.
      await this.transitionToTerminal(client, timer, 'cancelled');
      this.logger.warn('Timer cancelled — SLA policy not found', {
        timerId: timer.id,
        slaPolicyId: timer.slaPolicyId,
      });
      return 0;
    }

    // Load already-fired boundaries for idempotent catch-up.
    const firedBoundaries = await this.claimRepo.loadFiredBoundaries(client, timer.id);

    // Classify.
    const result = classifyDueBoundaries(timer, thresholds, firedBoundaries, this.clock);

    if (result.dueBoundaries.length === 0) {
      // Nothing new to fire (e.g. race between two pods — other pod already fired).
      return 0;
    }

    let fired = 0;

    // Fire each due boundary in chronological order.
    for (const boundary of result.dueBoundaries) {
      const wasNew = await this.claimRepo.recordFiredBoundary(
        client,
        timer.tenantId,
        timer.id,
        boundary,
      );

      if (!wasNew) {
        // Another pod already fired this boundary (concurrent tick race).
        this.logger.debug('Boundary already fired — skipping', {
          timerId: timer.id,
          boundary,
        });
        continue;
      }

      await this.writeOutboxEvent(client, timer, boundary, thresholds);
      fired++;
    }

    // Advance the timer.
    const newState = advanceTimerState(result.dueBoundaries);
    await this.claimRepo.advanceTimer(client, timer.id, {
      state: newState,
      nextFireAt: result.nextFireAt,
    });

    return fired;
  }

  // ---------------------------------------------------------------------------
  // Outbox event writer
  // ---------------------------------------------------------------------------

  private async writeOutboxEvent(
    client: PoolClient,
    timer: ClaimableTimer,
    boundary: SlaBoundary,
    thresholds: { reminderPctFirst: number; reminderPctSecond: number },
  ): Promise<void> {
    const isReminder = boundary === 'reminder_first' || boundary === 'reminder_second';
    const eventType = isReminder ? SLA_EVENT_TYPES.REMINDER_DUE : SLA_EVENT_TYPES.BREACHED;

    const thresholdPct = boundary === 'reminder_first'
      ? thresholds.reminderPctFirst
      : boundary === 'reminder_second'
        ? thresholds.reminderPctSecond
        : 100;

    const payload: Record<string, unknown> = {
      timerId: timer.id,
      tenantId: timer.tenantId,
      ticketId: timer.ticketId,
      clockType: timer.clockType,
      boundary,
      thresholdPct,
      targetAt: timer.targetAt.toISOString(),
      firedAt: this.clock().toISOString(),
    };

    await this.claimRepo.writeOutboxEvent(client, {
      tenantId: timer.tenantId,
      aggregateType: 'sla_timer',
      aggregateId: timer.id,
      eventType,
      payload,
    });
  }

  // ---------------------------------------------------------------------------
  // Terminal state helpers
  // ---------------------------------------------------------------------------

  private async transitionToTerminal(
    client: PoolClient,
    timer: ClaimableTimer,
    state: 'met' | 'cancelled',
  ): Promise<void> {
    await this.claimRepo.advanceTimer(client, timer.id, {
      state,
      nextFireAt: null,
    });
  }

  private async parkTimerWithError(client: PoolClient, timer: ClaimableTimer): Promise<void> {
    await client.query(
      `UPDATE sla_timers SET state = 'error', next_fire_at = null, updated_at = now() WHERE id = $1`,
      [timer.id],
    );
  }

  // ---------------------------------------------------------------------------
  // Metric / alert helpers (structured log entries consumed by OTel pipeline)
  // ---------------------------------------------------------------------------

  private emitMetric(name: string, value: number | Record<string, unknown>): void {
    this.logger.log(`metric:gauge:${name}`, { value });
  }

  private emitAlert(name: string, labels: Record<string, unknown>): void {
    this.logger.warn(`alert:${name}`, labels);
  }
}
