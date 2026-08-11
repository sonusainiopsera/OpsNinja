import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
} from 'drizzle-orm/pg-core';

// Data classification: Internal
// Retention: 7 years after deactivation (compliance requirement)
export const organizationStatusEnum = pgEnum('organization_status', ['active', 'inactive']);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug'),
    slaTier: text('sla_tier'),
    region: text('region'),
    // 'active' default; status column added in migration 005
    status: organizationStatusEnum('status').notNull().default('active'),
    // JSONB DevOps metadata — validated against custom_field_defs by application layer
    customFieldValues: jsonb('custom_field_values').notNull().default({}),
    primaryContactId: uuid('primary_contact_id'),
    domain: text('domain'),
    isActive: boolean('is_active').notNull().default(true),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    // CSAT survey configuration (added in migration 010)
    csatEnabled: boolean('csat_enabled').notNull().default(true),
    csatFatigueHours: integer('csat_fatigue_hours').notNull().default(72),
    csatExpiryDays: integer('csat_expiry_days').notNull().default(14),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('organizations_tenant_status_idx').on(t.tenantId, t.status),
    tenantSlaTierIdx: index('organizations_tenant_sla_tier_idx').on(t.tenantId, t.slaTier),
    // Unique index for composite FK references from child tables
    tenantIdUidx: uniqueIndex('organizations_tenant_id_uidx').on(t.tenantId, t.id),
  }),
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export const agentOrgScopes = pgTable(
  'agent_org_scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    accessLevel: text('access_level').notNull().default('full'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueUserOrg: uniqueIndex('agent_org_scopes_unique').on(t.tenantId, t.userId, t.organizationId),
    userIdx: index('agent_org_scopes_user_idx').on(t.tenantId, t.userId),
    orgIdx: index('agent_org_scopes_org_idx').on(t.tenantId, t.organizationId),
  }),
);

export type AgentOrgScope = typeof agentOrgScopes.$inferSelect;
export type NewAgentOrgScope = typeof agentOrgScopes.$inferInsert;
