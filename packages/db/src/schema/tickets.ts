/**
 * Tickets schema module.
 *
 * Both `tickets` and `ticket_comments` are declared PARTITION BY RANGE on
 * created_at in the SQL migration. The Drizzle schema module represents the
 * logical table shape for type-safe query building; partitioning DDL lives
 * exclusively in the migration.
 *
 * Design rules:
 * - tenant_id leads the composite PK on each table.
 * - tickets PK: (tenant_id, id, created_at) — created_at is required by
 *   PostgreSQL partition pruning: the partition key must be part of the PK
 *   for partitioned tables.
 * - ticket_comments PK: (tenant_id, id, created_at).
 * - Composite FKs (including tenant_id) are enforced in the SQL migration
 *   because PostgreSQL does not support FK references to partitioned tables
 *   in all configurations; the migration README documents each exception.
 * - priority check constraint: P1 | P2 | P3 | P4 (text, not pg enum, for
 *   forward-compatible extension without a migration).
 * - status check constraint: open | pending | on_hold | solved | closed.
 * - ticket_comments.visibility default is 'internal' for agent-authored
 *   comments; 'public' is explicitly set for portal-facing replies.
 */
import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const tickets = pgTable(
  'tickets',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid('id').notNull().defaultRandom(),
    /**
     * created_at is part of the PK to satisfy PostgreSQL's requirement that
     * the partition key column be included in the primary key of a
     * partitioned table.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    organizationId: uuid('organization_id').notNull(),
    requesterContactId: uuid('requester_contact_id'),
    assigneeUserId: uuid('assignee_user_id'),
    /**
     * status: open | pending | on_hold | solved | closed
     * Check constraint enforced in SQL migration.
     */
    status: text('status').notNull().default('open'),
    /**
     * priority: P1 | P2 | P3 | P4
     * P1 = critical, P4 = low. Check constraint enforced in SQL migration.
     */
    priority: text('priority').notNull().default('P3'),
    categoryId: uuid('category_id'),
    subject: text('subject').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id, table.createdAt] }),
  ],
);

export const ticketComments = pgTable(
  'ticket_comments',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid('id').notNull().defaultRandom(),
    /**
     * created_at is part of the PK for the same partition-key reason as
     * tickets.
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ticketId: uuid('ticket_id').notNull(),
    authorUserId: uuid('author_user_id').notNull(),
    /**
     * visibility: public | internal
     * Default 'internal' keeps agent notes hidden from portal by default.
     * Portal customers only see 'public' comments (enforced by RLS policy
     * in WO-003).
     * Check constraint enforced in SQL migration.
     */
    visibility: text('visibility').notNull().default('internal'),
    body: text('body').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.id, table.createdAt] }),
  ],
);

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type TicketComment = typeof ticketComments.$inferSelect;
export type NewTicketComment = typeof ticketComments.$inferInsert;
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
} from 'drizzle-orm/pg-core';

export const ticketStatusEnum = pgEnum('ticket_status', [
  'open',
  'in_progress',
  'pending',
  'resolved',
  'closed',
]);

export const ticketPriorityEnum = pgEnum('ticket_priority', ['p1', 'p2', 'p3', 'p4']);

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  organizationId: uuid('organization_id'),
  subject: text('subject').notNull(),
  description: text('description'),
  status: ticketStatusEnum('status').notNull().default('open'),
  priority: ticketPriorityEnum('priority').notNull().default('p4'),
  assigneeId: uuid('assignee_id'),
  createdById: uuid('created_by_id').notNull(),
  isPublic: boolean('is_public').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
