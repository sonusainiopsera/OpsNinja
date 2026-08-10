/**
 * Outbox schema module.
 *
 * `outbox_events` implements the transactional outbox pattern: every state
 * change inserts a row in the same database transaction as the business write.
 * The outbox drain loop polls unpublished rows and publishes them to SNS/SQS,
 * guaranteeing at-least-once delivery with no dual-write inconsistency.
 *
 * `retention_policies` is a data-driven configuration table consumed by the
 * future purge job so retention months are not hardcoded in application logic.
 *
 * Columns align with the WOREF-007 outbox contract:
 *   aggregate_type, aggregate_id, event_type, payload (jsonb),
 *   created_at, published_at, attempts, status, next_attempt_at, outbox_seq.
 *
 * Backoff and drain infrastructure added by 0005_outbox_backoff.sql.
 */
import {
  bigint,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const outboxEvents = pgTable(
  'outbox_events',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid('id').notNull().defaultRandom(),
    /**
     * aggregate_type: the domain entity type that produced the event, e.g.
     * 'ticket', 'organization', 'comment'.
     */
    aggregateType: text('aggregate_type').notNull(),
    /**
     * aggregate_id: UUID of the specific entity instance.
     */
    aggregateId: uuid('aggregate_id').notNull(),
    /**
     * event_type: domain event name, e.g. 'ticket.created', 'ticket.resolved',
     * 'comment.added'.
     */
    eventType: text('event_type').notNull(),
    /**
     * payload: full event envelope in JSONB. Consumers deserialise this
     * according to event_type.
     */
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * published_at: set by the outbox drain loop after successful publish.
     * NULL means the event has not yet been published.
     */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /**
     * attempts: incremented on each publish attempt by the drain loop.
     * Used to detect stuck events and drive exponential backoff.
     */
    attempts: integer('attempts').notNull().default(0),
    /**
     * status: current processing state.
     *   pending     — eligible for the drain loop.
     *   published   — successfully delivered; drain loop ignores.
     *   dead_letter — max attempts exceeded; requires operator replay.
     * Added by migration 0005_outbox_backoff.sql.
     */
    status: text('status').notNull().default('pending'),
    /**
     * next_attempt_at: when the drain loop may next attempt delivery.
     * NULL means "eligible immediately" (new rows).
     * Set to now() + backoff_seconds after a failed attempt.
     * Added by migration 0005_outbox_backoff.sql.
     */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    /**
     * outbox_seq: monotonic sequence for per-aggregate ordering tiebreaker.
     * Breaks ties when two events share the same created_at timestamp.
     * Added by migration 0005_outbox_backoff.sql.
     */
    outboxSeq: bigint('outbox_seq', { mode: 'number' }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

/**
 * retention_policies maps each high-volume table to its data retention
 * period in months. The purge job reads this table to determine which
 * monthly partitions to DETACH and drop.
 *
 * This table is NOT tenant-scoped because retention is a platform-wide
 * operational concern set by the platform team.
 */
export const retentionPolicies = pgTable('retention_policies', {
  tableName: text('table_name').primaryKey(),
  retentionMonths: integer('retention_months').notNull().default(24),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
export type RetentionPolicy = typeof retentionPolicies.$inferSelect;
export type NewRetentionPolicy = typeof retentionPolicies.$inferInsert;

/** Outbox event status values. */
export type OutboxStatus = 'pending' | 'published' | 'dead_letter';
