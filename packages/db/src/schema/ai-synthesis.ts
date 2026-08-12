/**
 * AI Synthesis schema — WO-062.
 *
 * Three tables:
 *   ticket_ai_summaries       — one row per (tenant_id, ticket_id); holds crux +
 *                               resolution summary, model metadata and status.
 *   ticket_affected_areas     — zero-to-many rows per summary; replaced atomically
 *                               on each re-synthesis.
 *   ai_synthesis_idempotency  — short-lived dedup guard keyed on (tenant_id, event_id);
 *                               rows expire after 7 days so storage doesn't grow unbounded.
 *
 * RLS: all three tables carry tenant_id and rely on the RLS policy
 *      "USING (tenant_id = current_setting('app.current_tenant')::uuid)"
 *      added in migration 0034_ai_synthesis.sql.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// ticket_ai_summaries
// ---------------------------------------------------------------------------

export const ticketAiSummaries = pgTable(
  'ticket_ai_summaries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),

    /**
     * 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
     *
     *   pending   — row created by ticket resolution before the worker picks it up
     *   running   — worker has begun inference; row claimed to prevent double-run
     *   succeeded — inference completed and rows written
     *   failed    — non-retryable error or all retries exhausted
     *   skipped   — tenant AI flag disabled or AiPolicy returned skip
     */
    aiStatus: text('ai_status').notNull().default('pending'),

    /** One-sentence crux — what was the core problem? */
    cruxSummary: text('crux_summary'),

    /** 2-3 sentence resolution — what was done and what is now true? */
    resolutionSummary: text('resolution_summary'),

    /** Bedrock model ARN or alias used for this synthesis. */
    modelId: text('model_id'),

    /** Prompt template version string (e.g. 'v1.0.0'). */
    promptVersion: text('prompt_version'),

    /** Timestamp the provider returned the response. */
    generatedAt: timestamp('generated_at', { withTimezone: true }),

    /** True when the thread was truncated before inference due to length. */
    truncated: boolean('truncated').notNull().default(false),

    /** Stable error code when ai_status = 'failed'. */
    lastErrorCode: text('last_error_code'),

    /**
     * Number of processing attempts made. Atomically incremented before each
     * LLM invocation so the cap is durable across worker crashes.
     * Cap = 3 (matches SQS maxReceiveCount). WO-064.
     */
    attemptCount: integer('attempt_count').notNull().default(0),

    /** Prompt token count (for cost tracking). */
    promptTokens: integer('prompt_tokens'),

    /** Completion token count (for cost tracking). */
    completionTokens: integer('completion_tokens'),

    /**
     * UUID of the last agent who edited the summary (set when source = 'human').
     * Null when no human edit has been made.
     */
    editedBy: uuid('edited_by'),

    /** Timestamp of the most recent human edit. */
    editedAt: timestamp('edited_at', { withTimezone: true }),

    /**
     * Human-readable reason when ai_status = 'skipped'.
     * E.g. 'budget_exceeded', 'tenant_disabled', 'attempt_cap_reached'.
     */
    skipReason: text('skip_reason'),

    /**
     * Optimistic-concurrency version counter. Incremented on every human edit
     * and on every regenerate. PATCH must send the current version; mismatch → 409.
     */
    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantTicketUniq: uniqueIndex('ticket_ai_summaries_tenant_ticket_uniq').on(
      t.tenantId,
      t.ticketId,
    ),
    tenantStatusIdx: index('ticket_ai_summaries_tenant_status_idx').on(
      t.tenantId,
      t.aiStatus,
    ),
  }),
);

export type TicketAiSummary = typeof ticketAiSummaries.$inferSelect;
export type NewTicketAiSummary = typeof ticketAiSummaries.$inferInsert;

// ---------------------------------------------------------------------------
// ticket_affected_areas
// ---------------------------------------------------------------------------

export const ticketAffectedAreas = pgTable(
  'ticket_affected_areas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    summaryId: uuid('summary_id').notNull(),

    /** Normalised area label — e.g. 'authentication', 'billing', 'api'. */
    areaLabel: text('area_label').notNull(),

    /** Model confidence — 'low' | 'medium' | 'high'. */
    confidence: text('confidence'),

    /**
     * Origin of this area: 'ai' (model-generated) or 'human' (agent-edited).
     * Human edits set source = 'human' for every row in the replacement set.
     */
    source: text('source').notNull().default('ai'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ticketIdx: index('ticket_affected_areas_ticket_idx').on(t.tenantId, t.ticketId),
    summaryIdx: index('ticket_affected_areas_summary_idx').on(t.summaryId),
  }),
);

export type TicketAffectedArea = typeof ticketAffectedAreas.$inferSelect;
export type NewTicketAffectedArea = typeof ticketAffectedAreas.$inferInsert;

// ---------------------------------------------------------------------------
// ai_synthesis_idempotency
// ---------------------------------------------------------------------------

export const aiSynthesisIdempotency = pgTable(
  'ai_synthesis_idempotency',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    /** outbox event id — the SQS message's eventId attribute. */
    eventId: uuid('event_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Expires after 7 days; application layer prunes rows older than this. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    tenantEventUniq: uniqueIndex('ai_synthesis_idempotency_tenant_event_uniq').on(
      t.tenantId,
      t.eventId,
    ),
    expiresAtIdx: index('ai_synthesis_idempotency_expires_at_idx').on(t.expiresAt),
  }),
);

export type AiSynthesisIdempotency = typeof aiSynthesisIdempotency.$inferSelect;
export type NewAiSynthesisIdempotency = typeof aiSynthesisIdempotency.$inferInsert;
