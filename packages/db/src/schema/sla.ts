import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  smallint,
  boolean,
  timestamp,
  date,
  time,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const slaPriorityEnum = pgEnum('sla_priority', ['P1', 'P2', 'P3', 'P4']);
export const slaCalendarTypeEnum = pgEnum('sla_calendar_type', ['business_hours', 'twenty_four_seven']);
export const slaScopeTypeEnum = pgEnum('sla_scope_type', ['tenant', 'organization', 'ticket_type']);

// ── sla_calendars ─────────────────────────────────────────────────────────────

export const slaCalendars = pgTable(
  'sla_calendars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    calendarType: slaCalendarTypeEnum('calendar_type').notNull(),
    timezone: text('timezone').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
  },
  (t) => ({
    tenantIdx: index('sla_calendars_tenant_idx').on(t.tenantId),
    tenantNameUidx: uniqueIndex('sla_calendars_tenant_name_uidx').on(t.tenantId, t.name),
  }),
);

export type SlaCalendar = typeof slaCalendars.$inferSelect;
export type NewSlaCalendar = typeof slaCalendars.$inferInsert;

// ── sla_calendar_windows ──────────────────────────────────────────────────────

export const slaCalendarWindows = pgTable(
  'sla_calendar_windows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    calendarId: uuid('calendar_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startLocalTime: time('start_local_time').notNull(),
    endLocalTime: time('end_local_time').notNull(),
  },
  (t) => ({
    tenantCalendarIdx: index('sla_calendar_windows_tenant_cal_idx').on(t.tenantId, t.calendarId),
  }),
);

export type SlaCalendarWindow = typeof slaCalendarWindows.$inferSelect;
export type NewSlaCalendarWindow = typeof slaCalendarWindows.$inferInsert;

// ── sla_calendar_holidays ─────────────────────────────────────────────────────

export const slaCalendarHolidays = pgTable(
  'sla_calendar_holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    calendarId: uuid('calendar_id').notNull(),
    holidayDate: date('holiday_date', { mode: 'string' }).notNull(),
    label: text('label').notNull(),
  },
  (t) => ({
    tenantCalendarIdx: index('sla_calendar_holidays_tenant_cal_idx').on(t.tenantId, t.calendarId),
    tenantCalDateUidx: uniqueIndex('sla_calendar_holidays_date_uidx').on(t.tenantId, t.calendarId, t.holidayDate),
  }),
);

export type SlaCalendarHoliday = typeof slaCalendarHolidays.$inferSelect;
export type NewSlaCalendarHoliday = typeof slaCalendarHolidays.$inferInsert;

// ── sla_policies ──────────────────────────────────────────────────────────────

export const slaPolicies = pgTable(
  'sla_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    scopeType: slaScopeTypeEnum('scope_type').notNull().default('tenant'),
    scopeId: uuid('scope_id'),
    priority: slaPriorityEnum('priority').notNull(),
    responseTargetMins: integer('response_target_mins').notNull(),
    resolutionTargetMins: integer('resolution_target_mins').notNull(),
    calendarId: uuid('calendar_id').notNull(),
    reminderPctFirst: integer('reminder_pct_first').notNull(),
    reminderPctSecond: integer('reminder_pct_second').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    targetsRatified: boolean('targets_ratified').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
  },
  (t) => ({
    tenantIdx: index('sla_policies_tenant_idx').on(t.tenantId),
    tenantScopePriorityUidx: uniqueIndex('sla_policies_tenant_scope_priority_uidx').on(
      t.tenantId, t.scopeType, t.priority,
    ),
  }),
);

export type SlaPolicy = typeof slaPolicies.$inferSelect;
export type NewSlaPolicy = typeof slaPolicies.$inferInsert;

// ── sla_policy_versions (append-only snapshot) ────────────────────────────────

export const slaPolicyVersions = pgTable(
  'sla_policy_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    policyId: uuid('policy_id').notNull(),
    version: integer('version').notNull(),
    payload: jsonb('payload').notNull(),
    changedBy: uuid('changed_by').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantPolicyIdx: index('sla_policy_versions_policy_idx').on(t.tenantId, t.policyId),
  }),
);

export type SlaPolicyVersion = typeof slaPolicyVersions.$inferSelect;
export type NewSlaPolicyVersion = typeof slaPolicyVersions.$inferInsert;
