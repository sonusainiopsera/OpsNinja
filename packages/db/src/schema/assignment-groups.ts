/**
 * Assignment groups schema module.
 *
 * assignment_groups         — tenant-scoped routing queues.
 * assignment_group_members  — membership join table (tenant, group, user).
 */
import {
  boolean,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const assignmentGroups = pgTable(
  'assignment_groups',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid('id').notNull().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

export const assignmentGroupMembers = pgTable(
  'assignment_group_members',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    groupId: uuid('group_id').notNull(),
    userId: uuid('user_id').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.groupId, table.userId] })],
);

export type AssignmentGroup = typeof assignmentGroups.$inferSelect;
export type NewAssignmentGroup = typeof assignmentGroups.$inferInsert;
export type AssignmentGroupMember = typeof assignmentGroupMembers.$inferSelect;
export type NewAssignmentGroupMember = typeof assignmentGroupMembers.$inferInsert;
