/**
 * ticket_comments schema — WO-031.
 *
 * Module ownership: tickets
 *
 * Visibility: 'public' comments are shown to portal users;
 * 'internal' comments are staff-only notes.
 */

import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const ticketComments = pgTable(
  'ticket_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),

    /** FK to tickets. Includes tenant_id at DB layer via composite FK in migration. */
    ticketId: uuid('ticket_id').notNull(),

    /** Denormalised from parent ticket for efficient portal visibility predicates. */
    organizationId: uuid('organization_id').notNull(),

    /** Staff user or portal contact who authored the comment. Null for system comments. */
    authorId: uuid('author_id'),

    /** 'public' — visible to portal users; 'internal' — agents/staff only. */
    visibility: text('visibility').notNull().default('public'),

    /**
     * When true, rendered in the UI with an internal-note banner.
     * Mirrors visibility='internal' for ergonomic access in application code.
     */
    isInternal: boolean('is_internal').notNull().default(false),

    /** Full comment body. No length cap at DB layer; 64KB+ bodies are fine. */
    body: text('body').notNull(),

    /**
     * External system comment ID for idempotent mirroring — e.g. the Jira
     * comment id.  Null for ordinary agent / portal comments.
     * Combined with external_source, forms a unique key preventing duplicate
     * mirrors on webhook redelivery (enforced by migration 0032 index).
     */
    externalRef: text('external_ref'),

    /**
     * The external system that originated the comment (e.g. 'jira').
     * Null for ordinary agent / portal comments.
     */
    externalSource: text('external_source'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ticket_comments_tenant_id_idx').on(t.tenantId),

    /** Primary access pattern: all comments for a ticket ordered by creation. */
    tenantTicketCreatedIdx: index('ticket_comments_tenant_ticket_created_idx').on(
      t.tenantId, t.ticketId, t.createdAt,
    ),

    visibilityIdx: index('ticket_comments_visibility_idx').on(t.ticketId, t.visibility),
  }),
);

export type TicketComment = typeof ticketComments.$inferSelect;
export type NewTicketComment = typeof ticketComments.$inferInsert;
