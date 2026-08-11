import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  domain: text('domain'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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
