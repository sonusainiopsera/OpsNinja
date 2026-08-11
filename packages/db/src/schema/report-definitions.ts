/**
 * Drizzle schema for report_definitions — WO-073.
 *
 * Stores validated report definitions with filter ASTs, metric lists,
 * group-by dimensions, and optional schedule configs.
 *
 * Schema ownership: exclusively owned by apps/api reporting module.
 * filter_ast, metrics, group_by columns hold validated JSON — the
 * ReportQueryCompiler rejects unknown field names at compile time.
 */

import { pgTable, uuid, text, timestamp, jsonb, integer, index } from 'drizzle-orm/pg-core';

export const reportDefinitions = pgTable(
  'report_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    metrics: jsonb('metrics').notNull().default([]),
    groupBy: jsonb('group_by').notNull().default([]),
    filterAst: jsonb('filter_ast'),
    chartType: text('chart_type'),
    sharingScope: text('sharing_scope').notNull().default('private'),
    /** Optimistic-concurrency version counter. Incremented on every update. */
    version: integer('version').notNull().default(1),
    schedule: jsonb('schedule'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantDeletedIdx: index('report_definitions_tenant_deleted_idx').on(t.tenantId, t.deletedAt),
    tenantScopeIdx: index('report_definitions_tenant_scope_idx').on(t.tenantId, t.sharingScope),
    tenantCreatedByIdx: index('report_definitions_tenant_created_by_idx').on(t.tenantId, t.createdBy),
  }),
);

export type ReportDefinition = typeof reportDefinitions.$inferSelect;
export type NewReportDefinition = typeof reportDefinitions.$inferInsert;
export type ReportSharingScope = 'private' | 'team' | 'tenant';
