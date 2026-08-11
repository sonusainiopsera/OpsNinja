/**
 * Drizzle schema for export_jobs — WO-073 + WO-076.
 *
 * Tracks async CSV export requests. The actual file is stored in S3;
 * only the opaque s3_key reference is persisted here.
 *
 * Status vocabulary (WO-076):
 *   queued     → job created, outbox event enqueued, awaiting worker
 *   processing → worker claimed the job (conditional transition guard)
 *   completed  → S3 object written, rowCount/byteSize recorded
 *   failed     → unrecoverable error after retry budget; errorCode set
 *   expired    → expiresAt passed; no download URL issued
 *
 * Schema ownership: exclusively owned by apps/api reporting module.
 * report_definition_id FK uses ON DELETE SET NULL so job history survives
 * definition deletion.
 */

import { pgTable, uuid, text, timestamp, integer, boolean, index } from 'drizzle-orm/pg-core';

export const exportJobs = pgTable(
  'export_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    reportDefinitionId: uuid('report_definition_id'),
    requestedBy: uuid('requested_by').notNull(),
    /** 'csv' */
    format: text('format').notNull(),
    /** 'queued' | 'processing' | 'completed' | 'failed' | 'expired' */
    status: text('status').notNull().default('queued'),
    /** Opaque S3 object key — never exposed directly in responses. */
    s3Key: text('s3_key'),
    rowCount: integer('row_count'),
    byteSize: integer('byte_size'),
    /** Set true when the 500k-row export cap was reached. */
    truncated: boolean('truncated').notNull().default(false),
    errorCode: text('error_code'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusIdx: index('export_jobs_tenant_status_idx').on(t.tenantId, t.status),
    tenantExpiresIdx: index('export_jobs_tenant_expires_idx').on(t.tenantId, t.expiresAt),
    tenantRequestedByIdx: index('export_jobs_tenant_requested_by_idx').on(
      t.tenantId,
      t.requestedBy,
      t.createdAt,
    ),
    idStatusIdx: index('export_jobs_id_status_idx').on(t.id, t.status),
  }),
);

export type ExportJob = typeof exportJobs.$inferSelect;
export type NewExportJob = typeof exportJobs.$inferInsert;
export type ExportJobFormat = 'csv';
export type ExportJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'expired';
