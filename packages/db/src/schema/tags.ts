/**
 * tags + ticket_tags schema — WO-031.
 *
 * Module ownership: tickets
 *
 * tags: tenant-scoped label definitions.
 * ticket_tags: many-to-many join between tickets and tags.
 *
 * ticket_tags has no surrogate PK — the composite (tenant_id, ticket_id, tag_id)
 * uniquely identifies a row and is the leading key of its primary index.
 */

import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// tags
// ---------------------------------------------------------------------------

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),

    /** Display label. Case-preserved; unique per tenant (case-insensitive in migration). */
    name: text('name').notNull(),

    /** Optional hex colour for UI badge rendering. e.g. '#4CAF50'. */
    color: text('color'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('tags_tenant_id_idx').on(t.tenantId),
    tenantNameUniq: index('tags_tenant_name_idx').on(t.tenantId, t.name),
  }),
);

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

// ---------------------------------------------------------------------------
// ticket_tags — join table
// ---------------------------------------------------------------------------

export const ticketTags = pgTable(
  'ticket_tags',
  {
    tenantId: uuid('tenant_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    tagId: uuid('tag_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.ticketId, t.tagId] }),
    tenantIdx: index('ticket_tags_tenant_id_idx').on(t.tenantId),
    ticketIdx: index('ticket_tags_ticket_id_idx').on(t.tenantId, t.ticketId),
    tagIdx: index('ticket_tags_tag_id_idx').on(t.tenantId, t.tagId),
  }),
);

export type TicketTag = typeof ticketTags.$inferSelect;
export type NewTicketTag = typeof ticketTags.$inferInsert;
