/**
 * assignment_groups + assignment_group_members schema — WO-031.
 *
 * Module ownership: tickets
 *
 * assignment_groups: named queues that tickets are routed to.
 * assignment_group_members: which staff users belong to each group.
 */

import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// assignment_groups
// ---------------------------------------------------------------------------

export const assignmentGroups = pgTable(
  'assignment_groups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),

    name: text('name').notNull(),
    description: text('description'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('assignment_groups_tenant_id_idx').on(t.tenantId),
    tenantNameIdx: index('assignment_groups_tenant_name_idx').on(t.tenantId, t.name),
  }),
);

export type AssignmentGroup = typeof assignmentGroups.$inferSelect;
export type NewAssignmentGroup = typeof assignmentGroups.$inferInsert;

// ---------------------------------------------------------------------------
// assignment_group_members
// ---------------------------------------------------------------------------

export const assignmentGroupMembers = pgTable(
  'assignment_group_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),

    /** FK to assignment_groups. */
    groupId: uuid('group_id').notNull(),

    /** FK to users. */
    userId: uuid('user_id').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('assignment_group_members_tenant_id_idx').on(t.tenantId),
    groupIdx: index('assignment_group_members_group_id_idx').on(t.tenantId, t.groupId),
    userIdx: index('assignment_group_members_user_id_idx').on(t.tenantId, t.userId),
  }),
);

export type AssignmentGroupMember = typeof assignmentGroupMembers.$inferSelect;
export type NewAssignmentGroupMember = typeof assignmentGroupMembers.$inferInsert;
