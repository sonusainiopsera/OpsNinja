/**
 * Tags schema module.
 *
 * tags            — tenant-scoped tag definitions with slug-based de-dup.
 * ticket_tags     — join table between tickets and tags; no FK to the
 *                   partitioned tickets table (app-validated per migration README).
 */
import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const tags = pgTable(
  'tags',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid('id').notNull().defaultRandom(),
    name: text('name').notNull(),
    /** URL-safe slug: lowercase, hyphens only. Unique per tenant. */
    slug: text('slug').notNull(),
    /** Optional hex colour string for UI rendering. */
    colour: text('colour'),
    isActive: boolean('is_active').notNull().default(true),
    /** Denormalised count — incremented/decremented by ticket_tags triggers or app logic. */
    usageCount: integer('usage_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

export const ticketTags = pgTable(
  'ticket_tags',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** UUID of the ticket (no FK because tickets is partitioned). */
    ticketId: uuid('ticket_id').notNull(),
    tagId: uuid('tag_id').notNull(),
    attachedAt: timestamp('attached_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.ticketId, table.tagId] })],
);

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type TicketTag = typeof ticketTags.$inferSelect;
export type NewTicketTag = typeof ticketTags.$inferInsert;
