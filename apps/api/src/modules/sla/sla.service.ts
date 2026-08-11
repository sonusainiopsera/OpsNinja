/**
 * SlaService — public entry point for SLA timer lifecycle (WO-045).
 *
 * Public API (called by TicketsModule — no direct sla_timers / sla_policies
 * imports allowed outside this service):
 *
 *   createTimersForTicket(params)         — call during ticket create transaction
 *   recomputeForPriorityChange(params)    — call during ticket priority-change update
 *
 * Both methods execute inside the caller's existing Drizzle transaction (shared
 * via AsyncLocalStorage — the caller never passes a connection object).
 *
 * Missing policy degrades gracefully: the ticket is still created, no timer is
 * inserted, sla_policy_missing_total increments, and a structured warning is
 * emitted. Any other exception propagates so the caller's transaction rolls back.
 *
 * OpenTelemetry: spans and counters are emitted as structured log entries with
 * metric: prefix so the log pipeline can route them to the metrics backend.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { SlaPolicy, SlaTimer } from '@opsninja/db';
import { SlaPolicyResolver } from './sla-policy-resolver.service';
import { SlaTimersRepository } from './sla-timers.repository';
import { SlaCalendarsRepository } from './sla-calendars.repository';
import {
  computeSlaTarget,
  computeNextFireAt,
  SlaTargetError,
  type CalendarSpec,
} from './domain/sla-target-calculator';

// ---------------------------------------------------------------------------
// Public parameter types
// ---------------------------------------------------------------------------

export interface CreateTimersParams {
  tenantId: string;
  ticketId: string;
  /** 'P1' | 'P2' | 'P3' | 'P4' */
  priority: string;
  organizationId: string | null;
  /** Ticket createdAt — used as the SLA clock start instant. */
  createdAt: Date;
}

export interface RecomputeParams {
  tenantId: string;
  ticketId: string;
  /** New priority after the change. */
  priority: string;
  organizationId: string | null;
  /** Human-readable reason recorded in the audit log. */
  reason: string;
  actorId: string | null;
}

// ---------------------------------------------------------------------------
// SlaService
// ---------------------------------------------------------------------------

@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    private readonly resolver: SlaPolicyResolver,
    private readonly timersRepo: SlaTimersRepository,
    private readonly calendarsRepo: SlaCalendarsRepository,
  ) {}

  // --------------------------------------------------------------------------
  // createTimersForTicket
  // --------------------------------------------------------------------------

  /**
   * Resolve the applicable SLA policy and insert both response and resolution
   * timers inside the caller's existing transaction.
   *
   * Missing policy: logs a warning, increments sla_policy_missing_total, returns
   * without error so the ticket create can still commit.
   *
   * Calculator error (misconfigured calendar): propagates — rolls back the
   * ticket create, which is preferable to creating a ticket with no timers
   * and no diagnostic.
   */
  async createTimersForTicket(params: CreateTimersParams): Promise<void> {
    const { tenantId, ticketId, priority, organizationId, createdAt } = params;

    this.emitSpan('sla.resolve_policy', { tenantId, priority });

    // ── Resolve policy ───────────────────────────────────────────────────────
    const policy = await this.resolver.resolve({ tenantId, organizationId, priority });

    if (policy === null) {
      this.logger.warn('No active SLA policy found — skipping timer creation', {
        tenantId, ticketId, priority, organizationId,
      });
      this.incrementCounter('sla_policy_missing_total', { priority });
      return; // Graceful degradation — ticket still commits.
    }

    // ── Load calendar ────────────────────────────────────────────────────────
    const calSpec = await this.loadCalendarSpec(tenantId, policy);
    if (calSpec === null) return; // Calendar missing — already logged.

    // ── Compute targets ──────────────────────────────────────────────────────
    this.emitSpan('sla.compute_target', { tenantId, clockType: 'response' });

    const responseTargetAt = computeSlaTarget({
      startAt: createdAt,
      targetMinutes: policy.responseTargetMins,
      calendar: calSpec,
    });

    this.emitSpan('sla.compute_target', { tenantId, clockType: 'resolution' });

    const resolutionTargetAt = computeSlaTarget({
      startAt: createdAt,
      targetMinutes: policy.resolutionTargetMins,
      calendar: calSpec,
    });

    // ── Compute next_fire_at ─────────────────────────────────────────────────
    const responseNextFireAt = computeNextFireAt({
      startedAt: createdAt,
      targetAt: responseTargetAt,
      reminderPctFirst: policy.reminderPctFirst,
      reminderPctSecond: policy.reminderPctSecond,
    });

    const resolutionNextFireAt = computeNextFireAt({
      startedAt: createdAt,
      targetAt: resolutionTargetAt,
      reminderPctFirst: policy.reminderPctFirst,
      reminderPctSecond: policy.reminderPctSecond,
    });

    // ── Insert timers (ON CONFLICT DO NOTHING — idempotent) ──────────────────
    await this.timersRepo.insertTimer({
      tenantId,
      ticketId,
      slaPolicyId: policy.id,
      clockType: 'response',
      state: 'running',
      pausedMs: 0,
      startedAt: createdAt,
      targetAt: responseTargetAt,
      nextFireAt: responseNextFireAt,
    });

    await this.timersRepo.insertTimer({
      tenantId,
      ticketId,
      slaPolicyId: policy.id,
      clockType: 'resolution',
      state: 'running',
      pausedMs: 0,
      startedAt: createdAt,
      targetAt: resolutionTargetAt,
      nextFireAt: resolutionNextFireAt,
    });

    this.incrementCounter('sla_timer_created_total', { clockType: 'response' });
    this.incrementCounter('sla_timer_created_total', { clockType: 'resolution' });

    this.logger.log('SLA timers created', {
      tenantId,
      ticketId,
      policyId: policy.id,
      responseTargetAt: responseTargetAt.toISOString(),
      resolutionTargetAt: resolutionTargetAt.toISOString(),
    });
  }

  // --------------------------------------------------------------------------
  // recomputeForPriorityChange
  // --------------------------------------------------------------------------

  /**
   * Recompute target_at and next_fire_at for both running/paused timers after
   * a priority change, preserving accumulated pausedMs and original startedAt.
   *
   * Writes an audit record capturing old and new policy IDs and targets.
   * Timers already in met/breached/cancelled state are left untouched.
   */
  async recomputeForPriorityChange(params: RecomputeParams): Promise<void> {
    const { tenantId, ticketId, priority, organizationId, reason } = params;

    // Load existing timers.
    const timers = await this.timersRepo.findByTicketId(tenantId, ticketId);
    const activeTimers = timers.filter(
      (t) => t.state === 'running' || t.state === 'paused',
    );

    if (activeTimers.length === 0) {
      this.logger.debug('No active timers to recompute for priority change', { tenantId, ticketId });
      return;
    }

    this.emitSpan('sla.resolve_policy', { tenantId, priority });

    const policy = await this.resolver.resolve({ tenantId, organizationId, priority });
    if (policy === null) {
      this.logger.warn('No policy for new priority — timers unchanged', { tenantId, ticketId, priority });
      this.incrementCounter('sla_policy_missing_total', { priority });
      return;
    }

    const calSpec = await this.loadCalendarSpec(tenantId, policy);
    if (calSpec === null) return;

    const now = new Date();

    for (const timer of activeTimers) {
      const targetMins = timer.clockType === 'response'
        ? policy.responseTargetMins
        : policy.resolutionTargetMins;

      this.emitSpan('sla.compute_target', { tenantId, clockType: timer.clockType });

      const newTargetAt = computeSlaTarget({
        startAt: timer.startedAt,
        targetMinutes: targetMins,
        calendar: calSpec,
      });

      const newNextFireAt = computeNextFireAt({
        startedAt: timer.startedAt,
        targetAt: newTargetAt,
        reminderPctFirst: policy.reminderPctFirst,
        reminderPctSecond: policy.reminderPctSecond,
      });

      await this.timersRepo.updateTimer(tenantId, timer.id, {
        slaPolicyId: policy.id,
        targetAt: newTargetAt,
        nextFireAt: newNextFireAt,
        lastStateChangeAt: now,
      });

      this.logger.log('SLA timer recomputed for priority change', {
        tenantId,
        ticketId,
        timerId: timer.id,
        clockType: timer.clockType,
        oldPolicyId: timer.slaPolicyId,
        newPolicyId: policy.id,
        oldTargetAt: timer.targetAt.toISOString(),
        newTargetAt: newTargetAt.toISOString(),
        reason,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async loadCalendarSpec(
    tenantId: string,
    policy: SlaPolicy,
  ): Promise<CalendarSpec | null> {
    const calendar = await this.calendarsRepo.findById(tenantId, policy.calendarId);
    if (!calendar) {
      this.logger.warn('Calendar not found for SLA policy — skipping timer creation', {
        tenantId,
        policyId: policy.id,
        calendarId: policy.calendarId,
      });
      return null;
    }

    const [windows, holidays] = await Promise.all([
      this.calendarsRepo.findWindowsByCalendarId(tenantId, policy.calendarId),
      this.calendarsRepo.findHolidaysByCalendarId(tenantId, policy.calendarId),
    ]);

    return {
      calendarType: calendar.calendarType as CalendarSpec['calendarType'],
      timezone: calendar.timezone,
      windows: windows.map((w) => ({
        weekday: w.weekday,
        startLocalTime: w.startLocalTime,
        endLocalTime: w.endLocalTime,
      })),
      holidays: holidays.map((h) => ({ holidayDate: h.holidayDate })),
    };
  }

  /** Emit a structured log entry consumable by the OpenTelemetry log exporter. */
  private emitSpan(name: string, attributes: Record<string, string>): void {
    this.logger.debug(`otel.span:${name}`, attributes);
  }

  /** Increment a counter (structured log entry for the metrics pipeline). */
  private incrementCounter(name: string, labels: Record<string, string>): void {
    this.logger.log(`metric.counter:${name}`, labels);
  }
}
