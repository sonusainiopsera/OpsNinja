/**
 * Drizzle ORM schema definitions for OpsNinja.
 *
 * Every table carries tenant_id so that PostgreSQL RLS policies can enforce
 * row-level isolation via the app.current_tenant session variable set by the
 * tenant-context interceptor.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Organizations (customers)
// ---------------------------------------------------------------------------

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    tier: text('tier').notNull().default('standard'),
    active: boolean('active').notNull().default(true),
    customFields: jsonb('custom_fields').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('organizations_tenant_id_idx').on(t.tenantId),
  }),
);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    email: text('email').notNull(),
    principalKind: text('principal_kind').notNull().default('staff'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('users_tenant_id_idx').on(t.tenantId),
    emailIdx: index('users_email_idx').on(t.email),
  }),
);

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    subject: text('subject').notNull(),
    status: text('status').notNull().default('open'),
    priority: text('priority').notNull().default('P3'),
    assigneeId: uuid('assignee_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('tickets_tenant_id_idx').on(t.tenantId),
    orgIdx: index('tickets_organization_id_idx').on(t.organizationId),
    statusIdx: index('tickets_status_idx').on(t.tenantId, t.status),
  }),
);

// ---------------------------------------------------------------------------
// Schema type exports
// ---------------------------------------------------------------------------

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
