/**
 * AI policy schema — WO-063.
 *
 * Two tables:
 *   tenant_ai_settings  — per-tenant enablement flag and monthly budget.
 *   tenant_ai_usage     — monthly period aggregates with atomic upsert semantics.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  bigint,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// tenant_ai_settings
// ---------------------------------------------------------------------------

export const tenantAiSettings = pgTable('tenant_ai_settings', {
  /** Tenant-scoped primary key — one row per tenant. */
  tenantId: uuid('tenant_id').primaryKey(),

  /** When false, all AI synthesis is skipped for this tenant. */
  aiEnabled: boolean('ai_enabled').notNull().default(true),

  /**
   * Maximum input+output tokens permitted per calendar month.
   * NULL means no budget cap (platform default applies).
   */
  monthlyTokenBudget: bigint('monthly_token_budget', { mode: 'number' }),

  /**
   * Percentage threshold at which a single soft-warning is emitted.
   * Default 80 means a warning fires when consumption reaches 80% of budget.
   */
  warnThresholdPct: integer('warn_threshold_pct').notNull().default(80),

  /**
   * Timestamp of the last fire-once warning emission for the current period.
   * Used as a durable backstop alongside the Redis SETNX key.
   */
  warnedAt: timestamp('warned_at', { withTimezone: true }),

  /**
   * Optimistic-concurrency version counter.
   * Incremented by PUT; PUT returns 409 when the submitted version doesn't match.
   */
  version: integer('version').notNull().default(1),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TenantAiSettings = typeof tenantAiSettings.$inferSelect;
export type NewTenantAiSettings = typeof tenantAiSettings.$inferInsert;

// ---------------------------------------------------------------------------
// tenant_ai_usage
// ---------------------------------------------------------------------------

export const tenantAiUsage = pgTable(
  'tenant_ai_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),

    /**
     * Calendar month in YYYY-MM format.
     * Period is always derived from the database now() to avoid clock-skew.
     */
    period: text('period').notNull(),

    /** Cumulative input (prompt) tokens consumed this period. */
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),

    /** Cumulative output (completion) tokens consumed this period. */
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),

    /** Number of synthesis requests completed this period. */
    requestCount: integer('request_count').notNull().default(0),

    /**
     * Estimated cost in integer micros (1 micro = 0.000001 USD).
     * Stored as integer to avoid floating-point drift.
     */
    estimatedCostMicros: bigint('estimated_cost_micros', { mode: 'number' }).notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantPeriodUniq: uniqueIndex('tenant_ai_usage_tenant_period_uniq').on(
      t.tenantId,
      t.period,
    ),
    tenantIdx: index('tenant_ai_usage_tenant_idx').on(t.tenantId),
  }),
);

export type TenantAiUsage = typeof tenantAiUsage.$inferSelect;
export type NewTenantAiUsage = typeof tenantAiUsage.$inferInsert;
