/**
 * Drizzle schema for jira_reconciliation_runs — WO-057.
 *
 * One row per reconciliation job execution against a jira_connection.
 * Append-only: no UPDATE or DELETE is ever issued from application code.
 * Outcome is set to 'running' on insert and updated to the final value on close.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const jiraReconciliationRuns = pgTable(
  'jira_reconciliation_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    issuesScanned: integer('issues_scanned').notNull().default(0),
    driftDetected: integer('drift_detected').notNull().default(0),
    eventsSynthesised: integer('events_synthesised').notNull().default(0),
    pendingRepaired: integer('pending_repaired').notNull().default(0),
    orphansFound: integer('orphans_found').notNull().default(0),
    durationMs: integer('duration_ms'),
    /** 'running' | 'completed' | 'truncated' | 'rate_limited' | 'failed' | 'skipped' */
    outcome: text('outcome').notNull().default('running'),
    error: text('error'),
    watermark: timestamp('watermark', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    connectionIdx: index('jira_recon_runs_connection_idx').on(t.tenantId, t.connectionId, t.createdAt),
  }),
);

export type JiraReconciliationRun = typeof jiraReconciliationRuns.$inferSelect;
export type NewJiraReconciliationRun = typeof jiraReconciliationRuns.$inferInsert;
export type ReconciliationOutcome =
  | 'running'
  | 'completed'
  | 'truncated'
  | 'rate_limited'
  | 'failed'
  | 'skipped';

// ---------------------------------------------------------------------------
// Re-export reconciliation columns added to jira_connections (for reference)
// ---------------------------------------------------------------------------

/** reconciliation_watermark and reconcile_lookback_hours are added via migration
 *  0040_jira_reconciliation.sql — they extend the jiraConnections table defined
 *  in jira-connections.ts. */
export const RECON_LOOKBACK_DEFAULT_HOURS = 2;
export const RECON_LOOKBACK_MAX_HOURS = 168; // 7 days
export const RECON_PAGE_SIZE = 100;
export const RECON_MAX_PAGES = 20;           // 2000 issues max per run
export const PENDING_REPAIR_AGE_MINUTES = 15;

// Smallint type re-export (used by JiraConnection patch type in queries)
export type { smallint };
