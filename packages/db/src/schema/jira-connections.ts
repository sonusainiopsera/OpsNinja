import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const jiraAuthMethodEnum = pgEnum('jira_auth_method', ['oauth3lo', 'api_token']);
export const jiraConnectionStateEnum = pgEnum('jira_connection_state', ['pending', 'active', 'degraded', 'revoked']);

// ── jira_connections ──────────────────────────────────────────────────────────

export const jiraConnections = pgTable(
  'jira_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    siteUrl: text('site_url').notNull(),
    cloudId: text('cloud_id').notNull(),
    authMethod: jiraAuthMethodEnum('auth_method').notNull(),
    scopes: text('scopes').array().notNull().default([]),
    secretRef: text('secret_ref').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    state: jiraConnectionStateEnum('state').notNull().default('pending'),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('jira_connections_tenant_idx').on(t.tenantId),
    tenantCloudIdUidx: uniqueIndex('jira_connections_tenant_cloud_id_uidx').on(t.tenantId, t.cloudId),
    globalCloudIdUidx: uniqueIndex('jira_connections_global_cloud_id_uidx').on(t.cloudId),
  }),
);

export type JiraConnection = typeof jiraConnections.$inferSelect;
export type NewJiraConnection = typeof jiraConnections.$inferInsert;
