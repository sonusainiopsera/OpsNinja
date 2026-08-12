/**
 * Drizzle schema for retention and erasure audit tables — WO-085/WO-095.
 *
 * retention_job_runs:   per-run observability for the nightly purge job.
 * erasure_receipts:     immutable GDPR erasure audit records (tenant-scoped).
 * retention_policies:   per-category retention configuration with optional
 *                       per-tenant overrides and platform bounds.
 * purge_runs:           append-only immutable ledger of every purge action.
 * subject_data_keys:    per-subject wrapped DEKs for crypto-shred.
 *
 * The first two tables are governed by audit retention policy and are explicitly
 * EXCLUDED from the purge job.
 */

import { pgTable, uuid, text, timestamp, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';

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

// ---------------------------------------------------------------------------
// retention_policies — WO-095
// ---------------------------------------------------------------------------

export type RetentionPolicyMode = 'dry_run' | 'enforce';

export const retentionPolicies = pgTable(
  'retention_policies',
  {
    id:            uuid('id').defaultRandom().primaryKey(),
    tenantId:      uuid('tenant_id'),  // NULL = platform default
    category:      text('category').notNull(),
    retentionDays: integer('retention_days').notNull(),
    mode:          text('mode').$type<RetentionPolicyMode>().notNull().default('dry_run'),
    createdBy:     text('created_by'),
    updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCategoryIdx: index('retention_policies_tenant_idx').on(t.tenantId, t.category),
  }),
);

export type RetentionPolicy = typeof retentionPolicies.$inferSelect;
export type NewRetentionPolicy = typeof retentionPolicies.$inferInsert;

// ---------------------------------------------------------------------------
// purge_runs — WO-095
// ---------------------------------------------------------------------------

export type PurgeRunOutcome = 'running' | 'success' | 'partial' | 'failure';

export const purgeRuns = pgTable(
  'purge_runs',
  {
    id:                uuid('id').defaultRandom().primaryKey(),
    startedAt:         timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt:        timestamp('finished_at', { withTimezone: true }),
    tenantId:          uuid('tenant_id'),  // NULL = cross-tenant platform run
    category:          text('category').notNull(),
    horizonAt:         timestamp('horizon_at', { withTimezone: true }).notNull(),
    partitionsDropped: text('partitions_dropped').array().notNull().default([]),
    rowsDeleted:       integer('rows_deleted').notNull().default(0),
    keysDestroyed:     integer('keys_destroyed').notNull().default(0),
    mode:              text('mode').$type<RetentionPolicyMode>().notNull().default('dry_run'),
    outcome:           text('outcome').$type<PurgeRunOutcome>().notNull().default('running'),
    errorSummary:      text('error_summary'),
    createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCategoryIdx: index('purge_runs_tenant_category_idx').on(t.tenantId, t.category, t.startedAt),
    categoryIdx:       index('purge_runs_category_idx').on(t.category, t.startedAt),
  }),
);

export type PurgeRun = typeof purgeRuns.$inferSelect;
export type NewPurgeRun = typeof purgeRuns.$inferInsert;

// ---------------------------------------------------------------------------
// subject_data_keys — WO-095
// ---------------------------------------------------------------------------

export const subjectDataKeys = pgTable(
  'subject_data_keys',
  {
    id:              uuid('id').defaultRandom().primaryKey(),
    tenantId:        uuid('tenant_id').notNull(),
    subjectType:     text('subject_type').notNull(),  // 'contact' | 'portal_user'
    subjectId:       uuid('subject_id').notNull(),
    kmsKeyArn:       text('kms_key_arn'),
    wrappedDek:      text('wrapped_dek'),
    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    destroyedAt:     timestamp('destroyed_at', { withTimezone: true }),
    erasureRequestId: uuid('erasure_request_id'),
  },
  (t) => ({
    subjectUniq:  uniqueIndex('subject_data_keys_subject_uniq').on(t.tenantId, t.subjectType, t.subjectId),
    tenantIdx:    index('subject_data_keys_tenant_idx').on(t.tenantId, t.destroyedAt),
  }),
);

export type SubjectDataKey = typeof subjectDataKeys.$inferSelect;
export type NewSubjectDataKey = typeof subjectDataKeys.$inferInsert;
