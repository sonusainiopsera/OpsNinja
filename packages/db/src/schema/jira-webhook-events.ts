/**
 * Drizzle schema for jira_webhook_events — WO-054.
 *
 * Append-only table for raw Jira webhook envelopes. Each row represents one
 * delivery attempt from Jira. Idempotency is enforced by the unique index on
 * (tenant_id, jira_event_id): a duplicate delivery conflicts on insert and is
 * returned as success without re-processing.
 *
 * processing_state lifecycle:
 *   'pending'       — received and queued, not yet processed by the sync worker
 *   'processing'    — claimed by a worker
 *   'processed'     — successfully applied to OpsNinja ticket state
 *   'ignored'       — unknown event type; persisted for audit but not applied
 *   'unlinked_drop' — no active ticket_jira_links row; dropped with warning
 *   'failed'        — worker exhausted retries; DLQ candidate
 *
 * 7-day TTL is enforced by the nightly purge job (registered in purge config).
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

export const jiraWebhookEvents = pgTable(
  'jira_webhook_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    /** Jira's own unique event identifier from the webhook payload webhookEvent or event timestamp+id. */
    jiraEventId: text('jira_event_id').notNull(),
    /** Raw Jira event type, e.g. 'jira:issue_updated', 'comment_created'. */
    eventType: text('event_type').notNull(),
    /** Jira issue numeric id from the payload (nullable for project-level events). */
    jiraIssueId: text('jira_issue_id'),
    /** Human-readable issue key, e.g. 'OPS-42'. */
    jiraIssueKey: text('jira_issue_key'),
    /** Full Jira webhook payload (PII-redaction applied by the sync worker before storage). */
    payload: jsonb('payload').notNull(),
    /** True when the X-Hub-Signature was verified; false for replays or force-ingests. */
    signatureVerified: boolean('signature_verified').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    /** See lifecycle states above. */
    processingState: text('processing_state').notNull().default('pending'),
    /** Worker retry count. */
    attempts: integer('attempts').notNull().default(0),
    /** Last error message from the sync worker (truncated to 2048 chars). */
    lastError: text('last_error'),
  },
  (t) => ({
    tenantEventUniq: uniqueIndex('jira_webhook_events_tenant_event_uniq').on(
      t.tenantId,
      t.jiraEventId,
    ),
    pendingIdx: index('jira_webhook_events_pending_idx').on(t.receivedAt),
    tenantIdx: index('jira_webhook_events_tenant_id_idx').on(t.tenantId),
  }),
);

export type JiraWebhookEvent = typeof jiraWebhookEvents.$inferSelect;
export type NewJiraWebhookEvent = typeof jiraWebhookEvents.$inferInsert;
export type WebhookProcessingState =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'ignored'
  | 'unlinked_drop'
  | 'failed';
