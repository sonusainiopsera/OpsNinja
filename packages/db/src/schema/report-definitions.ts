import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  bigint,
  index,
} from 'drizzle-orm/pg-core';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const reportChartTypeEnum = pgEnum('report_chart_type', [
  'table', 'bar', 'line', 'pie', 'area', 'heatmap',
]);

export const reportSharingScopeEnum = pgEnum('report_sharing_scope', [
  'private', 'team', 'tenant',
]);

export const exportJobFormatEnum = pgEnum('export_job_format', ['csv', 'xlsx', 'pdf']);

export const exportJobStatusEnum = pgEnum('export_job_status', [
  'pending', 'processing', 'completed', 'failed', 'expired',
]);

// ── report_definitions ────────────────────────────────────────────────────────

export const reportDefinitions = pgTable(
  'report_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    metrics: jsonb('metrics').notNull().default([]),
    groupBy: jsonb('group_by').notNull().default([]),
    filterAst: jsonb('filter_ast'),
    chartType: reportChartTypeEnum('chart_type').notNull().default('table'),
    sharingScope: reportSharingScopeEnum('sharing_scope').notNull().default('private'),
    schedule: jsonb('schedule'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('report_definitions_tenant_idx').on(t.tenantId, t.deletedAt),
    tenantScopeIdx: index('report_definitions_tenant_scope_idx').on(t.tenantId, t.sharingScope),
    tenantCreatedByIdx: index('report_definitions_tenant_created_by_idx').on(t.tenantId, t.createdBy),
  }),
);

export type ReportDefinition = typeof reportDefinitions.$inferSelect;
export type NewReportDefinition = typeof reportDefinitions.$inferInsert;

// ── export_jobs ───────────────────────────────────────────────────────────────

export const exportJobs = pgTable(
  'export_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    reportDefinitionId: uuid('report_definition_id'),
    requestedBy: uuid('requested_by').notNull(),
    format: exportJobFormatEnum('format').notNull(),
    status: exportJobStatusEnum('status').notNull().default('pending'),
    s3Key: text('s3_key'),
    rowCount: integer('row_count'),
    byteSize: bigint('byte_size', { mode: 'number' }),
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
