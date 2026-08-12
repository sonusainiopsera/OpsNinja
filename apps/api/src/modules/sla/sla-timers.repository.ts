/**
 * SlaTimersRepository — data access for sla_timers (WO-045, WO-047).
 *
 * Extends TenantRepository so all queries run inside the RLS-bound tenant
 * transaction. insertTimer uses ON CONFLICT DO NOTHING so a retried
 * ticket-create cannot produce duplicate clocks.
 *
 * WO-047 additions: pauseTimer, resumeTimer, completeTimer for the pause/resume
 * lifecycle. target_at is NEVER mutated by these methods (invariant from WO-047).
 */

import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import {
  slaTimers,
  type SlaTimer,
  type NewSlaTimer,
} from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';

@Injectable()
export class SlaTimersRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async findByTicketId(tenantId: string, ticketId: string): Promise<SlaTimer[]> {
    return this.tx
      .select()
      .from(slaTimers)
      .where(and(eq(slaTimers.tenantId, tenantId), eq(slaTimers.ticketId, ticketId)));
  }

  async findById(tenantId: string, id: string): Promise<SlaTimer | null> {
    const rows = await this.tx
      .select()
      .from(slaTimers)
      .where(and(eq(slaTimers.tenantId, tenantId), eq(slaTimers.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // Writes
  // --------------------------------------------------------------------------

  /**
   * Insert a timer using ON CONFLICT DO NOTHING on (tenant_id, ticket_id, clock_type).
   * Returns null when the row already existed (idempotent retry path).
   */
  async insertTimer(data: NewSlaTimer): Promise<SlaTimer | null> {
    const rows = await this.tx
      .insert(slaTimers)
      .values(data)
      .onConflictDoNothing()
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Partial update for priority-recompute path.
   * Only updates the supplied columns; tenant_id guard enforces RLS in code.
   */
  async updateTimer(
    tenantId: string,
    id: string,
    patch: Partial<Pick<SlaTimer, 'slaPolicyId' | 'targetAt' | 'nextFireAt' | 'lastStateChangeAt' | 'updatedAt'>>,
  ): Promise<SlaTimer | null> {
    const rows = await this.tx
      .update(slaTimers)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(slaTimers.tenantId, tenantId), eq(slaTimers.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // WO-047: Pause / Resume / Complete
  // NOTE: target_at is NEVER set here — it is immutable once created.
  // --------------------------------------------------------------------------

  /**
   * Transition a timer to 'paused' state.
   * - Sets state = 'paused', records pausedAt and pauseReason, nulls nextFireAt
   *   so the row leaves the running partial index (scheduler won't claim it).
   */
  async pauseTimer(
    tenantId: string,
    id: string,
    pausedAt: Date,
    pauseReason: string,
    now: Date,
  ): Promise<SlaTimer | null> {
    const rows = await this.tx
      .update(slaTimers)
      .set({
        state: 'paused',
        pausedAt,
        pauseReason,
        nextFireAt: null,         // leave the running partial index
        lastStateChangeAt: now,
        updatedAt: now,
      })
      .where(and(eq(slaTimers.tenantId, tenantId), eq(slaTimers.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Transition a timer from 'paused' to 'running' state.
   * - Adds the calendar-aware pause duration to pausedMs.
   * - Resets pausedAt and pauseReason to null.
   * - Sets nextFireAt to the next unfired boundary (recomputed by the service).
   */
  async resumeTimer(
    tenantId: string,
    id: string,
    newPausedMs: number,
    nextFireAt: Date | null,
    now: Date,
  ): Promise<SlaTimer | null> {
    const rows = await this.tx
      .update(slaTimers)
      .set({
        state: 'running',
        pausedMs: newPausedMs,
        pausedAt: null,
        pauseReason: null,
        nextFireAt,
        lastStateChangeAt: now,
        updatedAt: now,
      })
      .where(and(eq(slaTimers.tenantId, tenantId), eq(slaTimers.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Transition a timer to a terminal state ('met', 'breached', or 'cancelled').
   * - Nulls nextFireAt — terminal timers never fire again.
   */
  async completeTimer(
    tenantId: string,
    id: string,
    terminalState: 'met' | 'breached' | 'cancelled',
    now: Date,
  ): Promise<SlaTimer | null> {
    const rows = await this.tx
      .update(slaTimers)
      .set({
        state: terminalState,
        nextFireAt: null,
        pausedAt: null,
        lastStateChangeAt: now,
        updatedAt: now,
      })
      .where(and(eq(slaTimers.tenantId, tenantId), eq(slaTimers.id, id)))
      .returning();
    return rows[0] ?? null;
  }
}
