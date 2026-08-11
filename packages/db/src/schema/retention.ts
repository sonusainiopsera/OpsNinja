/**
 * Drizzle schema for retention and erasure audit tables — WO-085.
 *
 * retention_job_runs: per-run observability for the nightly purge job.
 * erasure_receipts:   immutable GDPR erasure audit records (tenant-scoped).
 *
 * These tables are governed by audit retention policy and are explicitly
 * EXCLUDED from the purge job — they must never be deleted by it.
 */

import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// retention_job_runs
// ---------------------------------------------------------------------------

export type RetentionJobOutcome = 'running' | 'success' | 'failure' | 'partial';

export const retentionJobRuns = pgTable(
  'retention_job_runs',
  {
    id:         uuid('id').defaultRandom().primaryKey(),
    jobName:    text('job_name').notNull(),
    startedAt:  timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    outcome:    text('outcome').$type<RetentionJobOutcome>().notNull().default('running'),
    /** Per-table summary: { tableName, rowsPurged, partitionsDropped, error? }[] */
    summary:    jsonb('summary').notNull().default([]),
    createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameStartedIdx: index('retention_job_runs_name_started_idx').on(t.jobName, t.startedAt),
  }),
);

export type RetentionJobRun = typeof retentionJobRuns.$inferSelect;
export type NewRetentionJobRun = typeof retentionJobRuns.$inferInsert;

// ---------------------------------------------------------------------------
// erasure_receipts
// ---------------------------------------------------------------------------

export const erasureReceipts = pgTable(
  'erasure_receipts',
  {
    id:          uuid('id').defaultRandom().primaryKey(),
    tenantId:    uuid('tenant_id').notNull(),
    requestId:   uuid('request_id').notNull(),
    /** Opaque reference to the data subject (contact_id or user_id). */
    subjectRef:  text('subject_ref').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
    /** [ { table: string, rowsAffected: number, strategy: string } ] */
    entries:     jsonb('entries').notNull().default([]),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestIdUniq:    uniqueIndex('erasure_receipts_request_id_uniq').on(t.tenantId, t.requestId),
    tenantSubjectIdx: index('erasure_receipts_tenant_subject_idx').on(t.tenantId, t.subjectRef),
  }),
);

export type ErasureReceipt = typeof erasureReceipts.$inferSelect;
export type NewErasureReceipt = typeof erasureReceipts.$inferInsert;

export interface ErasureReceiptEntry {
  table:        string;
  rowsAffected: number;
  strategy:     'tombstone' | 'crypto_shred' | 'delete';
}
