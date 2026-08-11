import { pgTable, pgEnum, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const commentVisibilityEnum = pgEnum('comment_visibility', ['public', 'internal']);

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  ticketId: uuid('ticket_id').notNull(),
  authorId: uuid('author_id').notNull(),
  body: text('body').notNull(),
  visibility: commentVisibilityEnum('visibility').notNull().default('public'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
