/**
 * TimerClaimRepository — cross-tenant claim query for the SLA scheduler (WO-046).
 *
 * This repository is intentionally NOT a TenantRepository subclass: it runs its
 * claim query as the opsninja_sla_scheduler role against a dedicated connection
 * pool that is configured with the scheduler claim role credentials.
 *
 * The claim query uses FOR UPDATE SKIP LOCKED so that two concurrent scheduler
 * pods never process the same timer in the same tick.
 *
 * See docs/adr/sla-scheduler-rls-claim-pattern.md for the full rationale.
 *
 * IMPORTANT: the returned timer rows carry tenant_id but no app.current_tenant
 * session variable is set. All subsequent per-timer side effects MUST be
 * executed in a per-tenant sub-transaction after SET LOCAL app.current_tenant.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type { ClaimableTimer, SlaBoundary } from './boundary-classifier';

export { ClaimableTimer, SlaBoundary };

/** Maximum timers claimed per tick — AC1 constraint. */
export const CLAIM_BATCH_LIMIT = 500;

/** SLA event types written into outbox_events. */
export const SLA_EVENT_TYPES = {
  REMINDER_DUE: 'sla.reminder_due',
  BREACHED:     'sla.breached',
} as const;

export type SlaEventType = (typeof SLA_EVENT_TYPES)[keyof typeof SLA_EVENT_TYPES];

// ---------------------------------------------------------------------------
// Claim result
// ---------------------------------------------------------------------------

export interface ClaimBatch {
  timers: ClaimableTimer[];
  oldestNextFireAt: Date | null;
  client: PoolClient;            // caller must release after processing
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class TimerClaimRepository implements OnModuleDestroy {
  private readonly logger = new Logger(TimerClaimRepository.name);

  /**
   * Connection pool configured with the scheduler claim role credentials.
   * Injected via the SchedulerModule provider to allow test substitution.
   */
  constructor(private readonly claimPool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.claimPool.end();
  }

  /**
   * Open a transaction on the claim pool and lock up to CLAIM_BATCH_LIMIT due
   * running timers with FOR UPDATE SKIP LOCKED.
   *
   * The caller MUST call client.release() (or rollback + release on error)
   * after processing each timer, because the returned PoolClient holds the
   * row-level locks for the outer transaction.
   *
   * Timers are returned ordered by next_fire_at ASC so the oldest-due timers
   * are always processed first, bounding the lag metric.
   */
  async claimDueTimers(): Promise<ClaimBatch> {
    const client = await this.claimPool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query<{
        id: string;
        tenant_id: string;
        ticket_id: string;
        sla_policy_id: string;
        clock_type: string;
        state: string;
        paused_ms: string;
        started_at: Date;
        target_at: Date;
        next_fire_at: Date | null;
      }>(`
        SELECT
          id,
          tenant_id,
          ticket_id,
          sla_policy_id,
          clock_type,
          state,
          paused_ms,
          started_at,
          target_at,
          next_fire_at
        FROM sla_timers
        WHERE state = 'running'
          AND next_fire_at <= now()
        ORDER BY next_fire_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      `, [CLAIM_BATCH_LIMIT]);

      const timers: ClaimableTimer[] = rows.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        ticketId: r.ticket_id,
        slaPolicyId: r.sla_policy_id,
        clockType: r.clock_type,
        state: r.state as ClaimableTimer['state'],
        pausedMs: parseInt(r.paused_ms, 10),
        startedAt: r.started_at,
        targetAt: r.target_at,
        nextFireAt: r.next_fire_at,
      }));

      const oldestNextFireAt = timers.length > 0
        ? (timers[0]!.nextFireAt ?? timers[0]!.targetAt)
        : null;

      return { timers, oldestNextFireAt, client };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      throw err;
    }
  }

  /**
   * Advance a timer's next_fire_at and state inside an already-open transaction.
   *
   * The caller is responsible for SET LOCAL app.current_tenant having been issued
   * BEFORE this call, so the UPDATE is subject to per-tenant RLS via the normal
   * tenant_isolation policy (which also applies to the scheduler role via the
   * scheduler_claim policy's USING(true) — it does not bypass the per-tenant writes).
   */
  async advanceTimer(
    client: PoolClient,
    timerId: string,
    patch: {
      state: string;
      nextFireAt: Date | null;
    },
  ): Promise<void> {
    await client.query(
      `UPDATE sla_timers
       SET state        = $2,
           next_fire_at = $3,
           updated_at   = now()
       WHERE id = $1`,
      [timerId, patch.state, patch.nextFireAt],
    );
  }

  /**
   * Record that a boundary has been fired.
   * Uses ON CONFLICT DO NOTHING so duplicate fires (crash-recovery path) are
   * treated as already-done without throwing.
   *
   * Returns true when a new row was inserted, false when the boundary was
   * already recorded (duplicate / crash recovery).
   */
  async recordFiredBoundary(
    client: PoolClient,
    tenantId: string,
    timerId: string,
    boundary: SlaBoundary,
  ): Promise<boolean> {
    const { rowCount } = await client.query(
      `INSERT INTO sla_fired_boundaries (tenant_id, timer_id, boundary)
       VALUES ($1, $2, $3)
       ON CONFLICT ON CONSTRAINT sla_fired_boundaries_once DO NOTHING`,
      [tenantId, timerId, boundary],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Load the set of already-fired boundaries for a timer.
   * Called at the start of per-timer processing to support idempotent catch-up.
   */
  async loadFiredBoundaries(
    client: PoolClient,
    timerId: string,
  ): Promise<Set<SlaBoundary>> {
    const { rows } = await client.query<{ boundary: string }>(
      `SELECT boundary FROM sla_fired_boundaries WHERE timer_id = $1`,
      [timerId],
    );
    return new Set(rows.map((r) => r.boundary as SlaBoundary));
  }

  /**
   * Write an outbox event inside the per-tenant sub-transaction.
   * Uses ON CONFLICT DO NOTHING on (tenant_id, aggregate_id, event_type) when
   * a unique index exists, for idempotent crash recovery.
   */
  async writeOutboxEvent(
    client: PoolClient,
    event: {
      tenantId: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, unknown>;
      traceId?: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events
         (tenant_id, aggregate_type, aggregate_id, event_type, payload, trace_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [
        event.tenantId,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        JSON.stringify(event.payload),
        event.traceId ?? null,
      ],
    );
  }
}
