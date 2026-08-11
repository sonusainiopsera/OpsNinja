/**
 * Drizzle schema for export_jobs — WO-073.
 *
 * Tracks async CSV/XLSX/PDF export requests. The actual file is stored in S3;
 * only the opaque s3_key reference is persisted here.
 *
 * Schema ownership: exclusively owned by apps/api reporting module.
 * report_definition_id FK uses ON DELETE SET NULL so job history survives
 * definition deletion.
 */

import { pgTable, uuid, text, timestamp, integer, index } from 'drizzle-orm/pg-core';

export const exportJobs = pgTable(
  'export_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    reportDefinitionId: uuid('report_definition_id'),
    requestedBy: uuid('requested_by').notNull(),
    /** 'csv' | 'xlsx' | 'pdf' */
    format: text('format').notNull(),
    /** 'pending' | 'running' | 'complete' | 'failed' | 'expired' */
    status: text('status').notNull().default('pending'),
    /** Opaque S3 object key — never exposed directly in responses. */
    s3Key: text('s3_key'),
    rowCount: integer('row_count'),
    byteSize: integer('byte_size'),
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
  }),
);

export type ExportJob = typeof exportJobs.$inferSelect;
export type NewExportJob = typeof exportJobs.$inferInsert;
export type ExportJobFormat = 'csv' | 'xlsx' | 'pdf';
export type ExportJobStatus = 'pending' | 'running' | 'complete' | 'failed' | 'expired';
