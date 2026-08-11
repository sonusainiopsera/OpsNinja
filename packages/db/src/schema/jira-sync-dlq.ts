/**
 * jira_sync_dlq schema — WO-056.
 *
 * Dead-letter projection for outbound Jira sync events that exhausted all
 * retry attempts.  Enables operators to inspect failures and replay individual
 * items or filtered batches without scanning SQS.
 *
 * RLS enabled and forced with tenant_isolation policy.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const jiraSyncDlq = pgTable(
  'jira_sync_dlq',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    linkId: uuid('link_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    /** Outbox event type that triggered this sync attempt. */
    eventType: text('event_type').notNull(),
    /** Full original outbox event payload for replay. */
    originalPayload: jsonb('original_payload').notNull().default({}),
    attempts: integer('attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    /** When an operator replayed this item. */
    replayedAt: timestamp('replayed_at', { withTimezone: true }),
    /** The user id of the operator who triggered replay. */
    replayedBy: uuid('replayed_by'),
  },
  (t) => ({
    tenantIdx: index('jira_sync_dlq_tenant_idx').on(t.tenantId, t.firstSeenAt),
    linkIdx: index('jira_sync_dlq_link_idx').on(t.tenantId, t.linkId),
  }),
);

export type JiraSyncDlqItem = typeof jiraSyncDlq.$inferSelect;
export type NewJiraSyncDlqItem = typeof jiraSyncDlq.$inferInsert;
