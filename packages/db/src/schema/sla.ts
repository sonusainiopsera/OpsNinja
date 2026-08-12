/**
 * Drizzle ORM schema for SLA module tables — WO-044.
 *
 * Tables:
 *  - sla_policies          — priority-based response/resolution targets
 *  - sla_policy_versions   — append-only snapshot per mutation (never UPDATE/DELETE)
 *  - sla_calendars         — business-hours or 24x7 working-time definitions
 *  - sla_calendar_windows  — per-weekday start/end times within a calendar
 *  - sla_calendar_holidays — date-keyed holiday overrides per calendar
 *
 * All tables carry a leading tenant_id for RLS and composite indexes.
 * Cross-module access must go through the SlaModule service interface only.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  bigint,
  boolean,
  jsonb,
  date,
  time,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';


// ---------------------------------------------------------------------------
// sla_calendars (defined first — sla_policies references it)
// ---------------------------------------------------------------------------

export const slaCalendars = pgTable(
  'sla_calendars',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    /** 'business_hours' or 'twenty_four_seven' */
    calendarType: text('calendar_type').notNull(),
    /** IANA timezone string (validated at service layer against Intl.supportedValuesOf) */
    timezone: text('timezone').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('sla_calendars_tenant_id_idx').on(t.tenantId),
    tenantNameIdx: index('sla_calendars_tenant_name_idx').on(t.tenantId, t.name),
  }),
);

export type SlaCalendar = typeof slaCalendars.$inferSelect;
export type NewSlaCalendar = typeof slaCalendars.$inferInsert;

// ---------------------------------------------------------------------------
// sla_calendar_windows
// ---------------------------------------------------------------------------

export const slaCalendarWindows = pgTable(
  'sla_calendar_windows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    calendarId: uuid('calendar_id').notNull(),
    /** 0 = Monday … 6 = Sunday (ISO weekday minus 1) */
    weekday: smallint('weekday').notNull(),
    startLocalTime: time('start_local_time').notNull(),
    endLocalTime: time('end_local_time').notNull(),
  },
  (t) => ({
    tenantCalendarIdx: index('sla_calendar_windows_tenant_calendar_idx').on(t.tenantId, t.calendarId),
  }),
);

export type SlaCalendarWindow = typeof slaCalendarWindows.$inferSelect;
export type NewSlaCalendarWindow = typeof slaCalendarWindows.$inferInsert;

// ---------------------------------------------------------------------------
// sla_calendar_holidays
// ---------------------------------------------------------------------------

export const slaCalendarHolidays = pgTable(
  'sla_calendar_holidays',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    calendarId: uuid('calendar_id').notNull(),
    holidayDate: date('holiday_date').notNull(),
    label: text('label').notNull(),
  },
  (t) => ({
    tenantCalendarIdx: index('sla_calendar_holidays_tenant_calendar_idx').on(t.tenantId, t.calendarId),
    uniqueDateIdx: uniqueIndex('sla_calendar_holidays_date_uniq').on(t.tenantId, t.calendarId, t.holidayDate),
  }),
);

export type SlaCalendarHoliday = typeof slaCalendarHolidays.$inferSelect;
export type NewSlaCalendarHoliday = typeof slaCalendarHolidays.$inferInsert;

// ---------------------------------------------------------------------------
// sla_policies
// ---------------------------------------------------------------------------

export const slaPolicies = pgTable(
  'sla_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    /** Scope discriminator: 'tenant' | 'organization' | 'custom' */
    scopeType: text('scope_type').notNull().default('tenant'),
    /** Non-null for organization/custom scope; null for tenant-wide */
    scopeId: uuid('scope_id'),
    /** Priority tier: 'P1' | 'P2' | 'P3' | 'P4' */
    priority: text('priority').notNull(),
    /** Response target in minutes; must be > 0 and <= 43200 (30 days) */
    responseTargetMins: integer('response_target_mins').notNull(),
    /** Resolution target in minutes; must be > 0 and <= 43200 */
    resolutionTargetMins: integer('resolution_target_mins').notNull(),
    /** FK to sla_calendars.id */
    calendarId: uuid('calendar_id').notNull(),
    /** First reminder threshold: 0–98, must be < reminderPctSecond */
    reminderPctFirst: integer('reminder_pct_first').notNull().default(50),
    /** Second reminder threshold: 1–99, must be > reminderPctFirst */
    reminderPctSecond: integer('reminder_pct_second').notNull().default(75),
    isActive: boolean('is_active').notNull().default(true),
    /** True once product has approved the target values. Defaults false (provisional). */
    targetsRatified: boolean('targets_ratified').notNull().default(false),
    /** Monotonic version counter; incremented on every update for optimistic locking. */
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => ({
    tenantIdx: index('sla_policies_tenant_id_idx').on(t.tenantId),
    tenantScopePriorityIdx: index('sla_policies_tenant_scope_priority_idx').on(
      t.tenantId, t.scopeType, t.scopeId, t.priority,
    ),
  }),
);

export type SlaPolicy = typeof slaPolicies.$inferSelect;
export type NewSlaPolicy = typeof slaPolicies.$inferInsert;

// ---------------------------------------------------------------------------
// sla_policy_versions (append-only snapshot — no UPDATE/DELETE)
// ---------------------------------------------------------------------------

export const slaPolicyVersions = pgTable(
  'sla_policy_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    policyId: uuid('policy_id').notNull(),
    version: integer('version').notNull(),
    /** Full serialised policy snapshot at this version. */
    payload: jsonb('payload').notNull(),
    changedBy: uuid('changed_by'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantPolicyIdx: index('sla_policy_versions_tenant_policy_idx').on(t.tenantId, t.policyId),
  }),
);

export type SlaPolicyVersion = typeof slaPolicyVersions.$inferSelect;
export type NewSlaPolicyVersion = typeof slaPolicyVersions.$inferInsert;

// ---------------------------------------------------------------------------
// sla_timers — durable per-ticket response and resolution clocks (WO-045)
// ---------------------------------------------------------------------------

export const slaTimers = pgTable(
  'sla_timers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    /** FK to sla_policies.id — recorded for audit reconstruction. */
    slaPolicyId: uuid('sla_policy_id').notNull(),
    /** 'response' | 'resolution' */
    clockType: text('clock_type').notNull(),
    /** 'running' | 'paused' | 'met' | 'breached' | 'cancelled' */
    state: text('state').notNull().default('running'),
    /** Accumulated paused duration in milliseconds (preserved across priority changes). */
    pausedMs: bigint('paused_ms', { mode: 'number' }).notNull().default(0),
    /** UTC instant the clock started (ticket createdAt; preserved across priority changes). */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** UTC instant by which the SLA must be met. */
    targetAt: timestamp('target_at', { withTimezone: true }).notNull(),
    /** Earliest of first-reminder, second-reminder and target_at — drives the scheduler scan. */
    nextFireAt: timestamp('next_fire_at', { withTimezone: true }),
    /** Set when the timer is paused; null when running/terminal. Added by migration 0038. */
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    /** Human-readable reason the timer was paused (e.g. 'status:pending_customer'). */
    pauseReason: text('pause_reason'),
    lastStateChangeAt: timestamp('last_state_change_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('sla_timers_tenant_idx').on(t.tenantId),
    /** Unique: one timer per clock type per ticket. Enforces idempotent ON CONFLICT DO NOTHING. */
    uniqueClockIdx: uniqueIndex('sla_timers_unique_clock').on(t.tenantId, t.ticketId, t.clockType),
    /** Partial index used by the 15-second scheduler scan — only running timers. */
    runningFireIdx: index('sla_timers_running_fire_idx').on(t.tenantId, t.nextFireAt),
  }),
);

export type SlaTimer = typeof slaTimers.$inferSelect;
export type NewSlaTimer = typeof slaTimers.$inferInsert;

// ---------------------------------------------------------------------------
// sla_timer_events — append-only audit log for timer state transitions (WO-047)
// ---------------------------------------------------------------------------

export const slaTimerEvents = pgTable(
  'sla_timer_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    timerId: uuid('timer_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    /** State before this transition (e.g. 'running'). */
    fromState: text('from_state').notNull(),
    /** State after this transition (e.g. 'paused'). */
    toState: text('to_state').notNull(),
    /** Human-readable reason for the transition (e.g. 'status:pending_customer'). */
    reason: text('reason'),
    /** Actor who triggered the transition; null for system-driven events. */
    actorId: uuid('actor_id'),
    /** UTC instant of the transition — partition key. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** Value of sla_timers.paused_ms at the time of this event. */
    pausedMsAtEvent: bigint('paused_ms_at_event', { mode: 'number' }).notNull().default(0),
    /** Working milliseconds elapsed when this event occurred. */
    elapsedMsAtEvent: bigint('elapsed_ms_at_event', { mode: 'number' }).notNull().default(0),
  },
  (t) => ({
    timerOccurredIdx: index('sla_timer_events_timer_occurred_idx').on(t.tenantId, t.timerId, t.occurredAt),
    tenantTicketIdx: index('sla_timer_events_tenant_ticket_idx').on(t.tenantId, t.ticketId),
  }),
);

export type SlaTimerEvent = typeof slaTimerEvents.$inferSelect;
export type NewSlaTimerEvent = typeof slaTimerEvents.$inferInsert;

// ---------------------------------------------------------------------------
// sla_reminder_emissions — idempotency log for SLA reminder dispatches (WO-048)
// ---------------------------------------------------------------------------

export const slaReminderEmissions = pgTable(
  'sla_reminder_emissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    timerId: uuid('timer_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    /** 50 for first reminder, 75 for second, 100 for breach. */
    thresholdPct: smallint('threshold_pct').notNull(),
    /** 'email' | 'webhook' */
    channel: text('channel').notNull(),
    /** Opaque reference: email address for email channel, endpoint UUID for webhook. */
    recipientRef: text('recipient_ref'),
    /** 'pending' | 'sent' | 'suppressed' | 'unroutable' | 'failed' | 'blocked' */
    deliveryStatus: text('delivery_status').notNull().default('pending'),
    /** Incremented on each delivery attempt (bounded by SQS redrive policy). */
    attemptCount: integer('attempt_count').notNull().default(0),
    /** Human-readable reason when delivery_status is 'suppressed' or 'unroutable'. */
    suppressedReason: text('suppressed_reason'),
    /** UTC instant when the notification was successfully dispatched. */
    emittedAt: timestamp('emitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Unique idempotency key: one emission record per (timer, threshold, channel). */
    idempotencyIdx: uniqueIndex('sla_reminder_emissions_idempotency_idx').on(
      t.timerId,
      t.thresholdPct,
      t.channel,
    ),
    /** Operator query: find pending/failed emissions for a tenant sorted by created_at. */
    tenantStatusIdx: index('sla_reminder_emissions_tenant_status_idx').on(
      t.tenantId,
      t.deliveryStatus,
      t.createdAt,
    ),
    tenantTicketIdx: index('sla_reminder_emissions_tenant_ticket_idx').on(t.tenantId, t.ticketId),
  }),
);

export type SlaReminderEmission = typeof slaReminderEmissions.$inferSelect;
export type NewSlaReminderEmission = typeof slaReminderEmissions.$inferInsert;
