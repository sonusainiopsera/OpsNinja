/**
 * SlaQueryService — read-side SLA query for GET /api/v1/tickets/:id/sla (WO-050).
 *
 * Computes per-clock elapsedMs, remainingMs, pausedMs, elapsedPct and state
 * using the same shared clock functions as the SLA scheduler, so the API and
 * the scheduler cannot disagree.
 *
 * Exported method:
 *   getTicketSla(tenantId, ticketId) → TicketSlaResult
 *
 * Returns null when no timers exist (caller should return 200 with no_policy reason).
 * Timers in met, breached or cancelled states are included as terminal snapshots.
 */

import { Injectable } from '@nestjs/common';
import type { SlaTimer } from '@opsninja/db';
import {
  computeElapsed,
  computeRemaining,
  elapsedPct as computeElapsedPct,
  type CalendarSpec,
} from './domain/sla-clock';
import { SlaTimersRepository } from './sla-timers.repository';
import { SlaPoliciesRepository } from './sla-policies.repository';
import { SlaCalendarsRepository } from './sla-calendars.repository';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export type SlaClockType = 'response' | 'resolution';
export type SlaClockState = 'running' | 'paused' | 'met' | 'breached' | 'cancelled';

export interface SlaClockResult {
  clockType: SlaClockType;
  state: SlaClockState;
  targetAt: string;
  startedAt: string;
  elapsedMs: number;
  remainingMs: number;
  pausedMs: number;
  elapsedPct: number;
  thresholds: {
    first: number;
    second: number;
  };
  computedAt: string;
}

export interface TicketSlaResult {
  ticketId: string;
  clocks: SlaClockResult[];
  /** Present when no timer exists — caller returns 200 with this reason. */
  reason?: 'no_policy';
}

// ---------------------------------------------------------------------------
// CalendarSpec builder helpers
// ---------------------------------------------------------------------------

const TWENTY_FOUR_SEVEN_SPEC: CalendarSpec = {
  calendarType: 'twenty_four_seven',
  timezone: 'UTC',
  windows: [],
  holidays: [],
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SlaQueryService {
  constructor(
    private readonly timersRepo: SlaTimersRepository,
    private readonly policiesRepo: SlaPoliciesRepository,
    private readonly calendarsRepo: SlaCalendarsRepository,
  ) {}

  /**
   * Compute SLA clock values for all timers on a ticket.
   *
   * @returns TicketSlaResult with empty clocks + reason='no_policy' when no timer exists.
   */
  async getTicketSla(tenantId: string, ticketId: string): Promise<TicketSlaResult> {
    const timers = await this.timersRepo.findByTicketId(tenantId, ticketId);

    if (timers.length === 0) {
      return { ticketId, clocks: [], reason: 'no_policy' };
    }

    const now = new Date();
    const computedAt = now.toISOString();

    const clocks: SlaClockResult[] = await Promise.all(
      timers.map((timer) => this.computeClockResult(tenantId, timer, now, computedAt)),
    );

    return { ticketId, clocks };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async computeClockResult(
    tenantId: string,
    timer: SlaTimer,
    now: Date,
    computedAt: string,
  ): Promise<SlaClockResult> {
    const state = timer.state as SlaClockState;

    // For terminal states (met / cancelled), return a static snapshot.
    if (state === 'met' || state === 'cancelled') {
      return this.terminalSnapshot(timer, state, computedAt);
    }

    // Load calendar for accurate working-time computation.
    const calendarSpec = await this.resolveCalendarSpec(tenantId, timer.slaPolicyId);

    // Resolve thresholds from the policy.
    const thresholds = await this.resolveThresholds(tenantId, timer.slaPolicyId);

    // pausedAt: when state is paused, lastStateChangeAt records when the pause started.
    const pausedAt =
      state === 'paused' && timer.lastStateChangeAt
        ? new Date(timer.lastStateChangeAt)
        : null;

    const clockParams = {
      startedAt: new Date(timer.startedAt),
      targetAt: new Date(timer.targetAt),
      pausedMs: timer.pausedMs ?? 0,
      pausedAt,
      now,
      calendar: calendarSpec,
    };

    const elapsedMs = computeElapsed(clockParams);
    const remainingMs = computeRemaining(clockParams);
    const pct = computeElapsedPct(clockParams);

    // Client-side breach detection: if computed remaining ≤ 0 and state is running,
    // report as breached (scheduler may not have fired yet).
    const effectiveState: SlaClockState =
      state === 'breached' || (state === 'running' && remainingMs <= 0)
        ? 'breached'
        : state;

    return {
      clockType: timer.clockType as SlaClockType,
      state: effectiveState,
      targetAt: new Date(timer.targetAt).toISOString(),
      startedAt: new Date(timer.startedAt).toISOString(),
      elapsedMs,
      remainingMs: Math.max(0, remainingMs),
      pausedMs: timer.pausedMs ?? 0,
      elapsedPct: Math.round(pct * 100) / 100,
      thresholds,
      computedAt,
    };
  }

  private terminalSnapshot(
    timer: SlaTimer,
    state: 'met' | 'cancelled',
    computedAt: string,
  ): SlaClockResult {
    // For terminal states, elapsed = total span (target - start).
    // We don't need the calendar because remainingMs = 0 and state is final.
    const startMs = new Date(timer.startedAt).getTime();
    const targetMs = new Date(timer.targetAt).getTime();
    const totalMs = Math.max(0, targetMs - startMs);
    const elapsedMs = state === 'met' ? totalMs : 0;

    return {
      clockType: timer.clockType as SlaClockType,
      state,
      targetAt: new Date(timer.targetAt).toISOString(),
      startedAt: new Date(timer.startedAt).toISOString(),
      elapsedMs,
      remainingMs: 0,
      pausedMs: timer.pausedMs ?? 0,
      elapsedPct: state === 'met' ? 100 : 0,
      thresholds: { first: 50, second: 75 }, // defaults for terminal; overridden below
      computedAt,
    };
  }

  private async resolveCalendarSpec(tenantId: string, policyId: string): Promise<CalendarSpec> {
    const policy = await this.policiesRepo.findById(tenantId, policyId);
    if (!policy || !policy.calendarId) {
      return TWENTY_FOUR_SEVEN_SPEC;
    }

    const calendar = await this.calendarsRepo.findById(tenantId, policy.calendarId);
    if (!calendar) return TWENTY_FOUR_SEVEN_SPEC;

    if (calendar.calendarType === 'twenty_four_seven') {
      return { ...TWENTY_FOUR_SEVEN_SPEC, timezone: calendar.timezone };
    }

    const [windows, holidays] = await Promise.all([
      this.calendarsRepo.findWindowsByCalendarId(tenantId, policy.calendarId),
      this.calendarsRepo.findHolidaysByCalendarId(tenantId, policy.calendarId),
    ]);

    return {
      calendarType: 'business_hours',
      timezone: calendar.timezone,
      windows: windows.map((w) => ({
        weekday: w.weekday,
        startLocalTime: w.startLocalTime,
        endLocalTime: w.endLocalTime,
      })),
      holidays: holidays.map((h) => ({
        holidayDate: h.holidayDate,
      })),
    };
  }

  private async resolveThresholds(
    tenantId: string,
    policyId: string,
  ): Promise<{ first: number; second: number }> {
    const policy = await this.policiesRepo.findById(tenantId, policyId);
    if (!policy) return { first: 50, second: 75 };
    return {
      first: policy.firstReminderPct ?? 50,
      second: policy.secondReminderPct ?? 75,
    };
  }
}
