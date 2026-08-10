/**
 * Identity schema module.
 *
 * Covers: users, customer_contacts, role_assignments, agent_org_scopes.
 *
 * Design rules:
 * - All tables have tenant_id as the leading column of their composite PK.
 * - Composite FKs (tenant_id, entity_id) enforce cross-tenant containment.
 * - users.kind distinguishes internal staff ('staff') from portal users
 *   ('portal') so auth guards can enforce the appropriate login path.
 * - role_assignments.scope_version is bumped on every org-scope change;
 *   the JWT claims cache busts when this version advances, forcing
 *   re-issuance within 15 minutes at most.
 * - agent_org_scopes.access_level: read | write | admin
 *   Check constraint enforced in SQL migration.
 */
import {
  bigint,
  boolean,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
// Composite FKs to organizations are enforced in the SQL migration only
// (Drizzle ORM does not generate composite FK DDL). See 0001_foundation.sql.

export const users = pgTable(
  'users',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid('id').notNull().defaultRandom(),
    /**
     * external_subject: the OIDC `sub` claim from the IdP, or null for
     * portal users who use magic-link / email verification.
     */
    externalSubject: text('external_subject'),
    email: text('email').notNull(),
    /**
     * kind: staff | portal
     * staff = internal agent/admin/manager/lead
     * portal = external customer user
     * Check constraint enforced in SQL migration.
     */
    kind: text('kind').notNull(),
    /**
     * status: active | inactive | pending
     * Check constraint enforced in SQL migration.
     */
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

/**
 * customer_contacts are external-facing contact records tied to an
 * organization. A contact may have portal_access_enabled=true, in which case
 * a corresponding users row exists (kind='portal').
 *
 * Composite FK (tenant_id, organization_id) → organizations prevents
 * cross-tenant contact attachment.
 */
export const customerContacts = pgTable(
  'customer_contacts',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid('id').notNull().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    portalAccessEnabled: boolean('portal_access_enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

/**
 * role_assignments maps users to roles within a tenant.
 *
 * roles: admin | agent | manager | lead | integration_admin | portal_user
 * Check constraint enforced in SQL migration.
 *
 * scope_version is incremented by the Support Manager when org-scope
 * changes occur. The auth guard compares the JWT claim against this value
 * and forces re-auth if they diverge, bounding the stale-scope window.
 */
export const roleAssignments = pgTable(
  'role_assignments',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id').notNull(),
    /**
     * role: admin | agent | manager | lead | integration_admin | portal_user
     */
    role: text('role').notNull(),
    /**
     * scope_version: monotonic bigint counter, bumped whenever the agent's
     * org-scope changes. The JWT claim is compared against this; a mismatch
     * forces immediate re-issuance. Mode 'number' is safe for this counter.
     */
    scopeVersion: bigint('scope_version', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId, table.role] }),
  ],
);

/**
 * agent_org_scopes controls which organizations an agent can access.
 *
 * Composite PK (tenant_id, user_id, organization_id).
 * Composite FKs to both users and organizations (enforced in SQL migration
 * as Drizzle does not generate composite FK DDL).
 */
export const agentOrgScopes = pgTable(
  'agent_org_scopes',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    /**
     * access_level: read | write | admin
     * Check constraint enforced in SQL migration.
     */
    accessLevel: text('access_level').notNull().default('read'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.userId, table.organizationId],
    }),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type CustomerContact = typeof customerContacts.$inferSelect;
export type NewCustomerContact = typeof customerContacts.$inferInsert;
export type RoleAssignment = typeof roleAssignments.$inferSelect;
export type NewRoleAssignment = typeof roleAssignments.$inferInsert;
export type AgentOrgScope = typeof agentOrgScopes.$inferSelect;
export type NewAgentOrgScope = typeof agentOrgScopes.$inferInsert;
