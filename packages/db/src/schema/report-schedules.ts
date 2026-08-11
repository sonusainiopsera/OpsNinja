/**
 * Drizzle schema for report_schedules and report_schedule_occurrences — WO-075.
 *
 * report_schedules: durable rows claimed by the scheduler worker with
 *   FOR UPDATE SKIP LOCKED, mirroring the SLA timer pattern.
 *
 * report_schedule_occurrences: one row per (tenant_id, schedule_id, fire_at)
 *   protected by the unique occurrence_key index — the idempotency gate that
 *   prevents duplicate dispatch across restarts, concurrent schedulers, and
 *   SQS redelivery.
 *
 * external_recipient_allowlist: audited approved-external-address list.
 *   Defaults to deny — non-matching external addresses are rejected at save.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// report_schedules
// ---------------------------------------------------------------------------

export const reportSchedules = pgTable(
  'report_schedules',
  {
    id:                   uuid('id').defaultRandom().primaryKey(),
    tenantId:             uuid('tenant_id').notNull(),
    reportDefinitionId:   uuid('report_definition_id').notNull(),
    /** 'daily' | 'weekly' | 'monthly' | 'custom' */
    cadence:              text('cadence').notNull(),
    /** Standard 5-field cron expression. Minimum interval enforced: 1 hour. */
    cronExpression:       text('cron_expression').notNull(),
    /** IANA timezone string, e.g. 'America/New_York'. */
    timezone:             text('timezone').notNull().default('UTC'),
    /** 'csv' | 'pdf' */
    format:               text('format').notNull().default('csv'),
    /**
     * JSON array of recipient objects:
     *   [{ type: 'user', userId: '...' }, { type: 'external', email: '...' }]
     * Validated against verified domains + allowlist at save time.
     */
    recipients:           jsonb('recipients').notNull().default([]),
    enabled:              boolean('enabled').notNull().default(true),
    /** UTC timestamp of the next scheduled dispatch. Null when disabled. */
    nextFireAt:           timestamp('next_fire_at', { withTimezone: true }),
    lastFiredAt:          timestamp('last_fired_at', { withTimezone: true }),
    createdBy:            uuid('created_by'),
    createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    claimIdx: index('report_schedules_claim_idx').on(t.nextFireAt),
    tenantIdx: index('report_schedules_tenant_id_idx').on(t.tenantId),
    definitionIdx: index('report_schedules_definition_id_idx').on(t.tenantId, t.reportDefinitionId),
  }),
);

export type ReportSchedule = typeof reportSchedules.$inferSelect;
export type NewReportSchedule = typeof reportSchedules.$inferInsert;
export type ReportScheduleCadence = 'daily' | 'weekly' | 'monthly' | 'custom';
export type ReportScheduleFormat = 'csv' | 'pdf';

export interface ScheduleRecipient {
  type: 'user' | 'external';
  userId?: string;  // for type='user'
  email?: string;   // for type='external'
}

// ---------------------------------------------------------------------------
// report_schedule_occurrences
// ---------------------------------------------------------------------------

export const reportScheduleOccurrences = pgTable(
  'report_schedule_occurrences',
  {
    id:             uuid('id').defaultRandom().primaryKey(),
    tenantId:       uuid('tenant_id').notNull(),
    scheduleId:     uuid('schedule_id').notNull(),
    fireAt:         timestamp('fire_at', { withTimezone: true }).notNull(),
    /**
     * Deterministic idempotency key: sha256(tenantId + ':' + scheduleId + ':' + fireAtMinute).
     * The unique index on this column is the dispatch idempotency gate.
     */
    occurrenceKey:  text('occurrence_key').notNull(),
    /** Set when the export worker links its job back. */
    exportJobId:    uuid('export_job_id'),
    /**
     * 'pending'    — occurrence inserted, outbox event enqueued
     * 'dispatched' — export worker claimed the job
     * 'completed'  — export delivered
     * 'failed'     — retry budget exhausted, DLQ
     * 'skipped'    — missed fire during outage, not backfilled
     */
    status:         text('status').notNull().default('pending'),
    attempts:       integer('attempts').notNull().default(0),
    errorCode:      text('error_code'),
    createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    occurrenceKeyUniq: uniqueIndex('report_schedule_occurrences_key_uniq').on(t.occurrenceKey),
    tenantIdx:         index('report_schedule_occurrences_tenant_id_idx').on(t.tenantId),
    scheduleIdx:       index('report_schedule_occurrences_schedule_idx').on(t.tenantId, t.scheduleId, t.fireAt),
  }),
);

export type ReportScheduleOccurrence = typeof reportScheduleOccurrences.$inferSelect;
export type NewReportScheduleOccurrence = typeof reportScheduleOccurrences.$inferInsert;
export type OccurrenceStatus = 'pending' | 'dispatched' | 'completed' | 'failed' | 'skipped';

// ---------------------------------------------------------------------------
// external_recipient_allowlist
// ---------------------------------------------------------------------------

export const externalRecipientAllowlist = pgTable(
  'external_recipient_allowlist',
  {
    id:          uuid('id').defaultRandom().primaryKey(),
    tenantId:    uuid('tenant_id').notNull(),
    email:       text('email').notNull(),
    approvedBy:  uuid('approved_by').notNull(),
    approvedAt:  timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
    note:        text('note'),
    revokedAt:   timestamp('revoked_at', { withTimezone: true }),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUniq:  uniqueIndex('external_recipient_allowlist_email_uniq').on(t.tenantId, t.email),
    tenantIdx:  index('external_recipient_allowlist_tenant_idx').on(t.tenantId),
  }),
);

export type ExternalRecipientAllowlistEntry = typeof externalRecipientAllowlist.$inferSelect;
export type NewExternalRecipientAllowlistEntry = typeof externalRecipientAllowlist.$inferInsert;
