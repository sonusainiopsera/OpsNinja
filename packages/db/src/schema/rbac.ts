/**
 * RBAC schema module.
 *
 * Covers: roles, permissions, role_permissions (global catalog tables),
 * and user_roles (per-tenant assignment).
 *
 * Design rules:
 * - roles, permissions, role_permissions are platform-level (no tenant_id);
 *   no RLS is applied to them.
 * - user_roles is tenant-scoped; tenant_id is the leading PK column and
 *   RLS policy tenant_isolation is applied in migration 0009.
 * - role_id in user_roles is a FK to roles(id), normalizing the role name
 *   out of the assignment row.
 */
import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const roles = pgTable('roles', {
  id:          uuid('id').notNull().defaultRandom(),
  name:        text('name').notNull(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.id] }),
]);

export const permissions = pgTable('permissions', {
  id:          uuid('id').notNull().defaultRandom(),
  code:        text('code').notNull(),
  description: text('description'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.id] }),
]);

export const rolePermissions = pgTable('role_permissions', {
  roleId:       uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.roleId, table.permissionId] }),
]);

export const userRoles = pgTable(
  'user_roles',
  {
    tenantId:  uuid('tenant_id').notNull().references(() => tenants.id),
    userId:    uuid('user_id').notNull(),
    roleId:    uuid('role_id').notNull().references(() => roles.id),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by'),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId, table.roleId] }),
  ],
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;
