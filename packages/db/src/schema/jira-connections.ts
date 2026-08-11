/**
 * Drizzle schema for jira_connections — WO-051.
 *
 * Each row represents a Jira Cloud (OAuth 3LO) or Jira Data Center (API token)
 * connection for one tenant. The refresh token / API token is never stored here;
 * only a Secrets Manager reference is held in secret_ref.
 */

import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const jiraConnections = pgTable(
  'jira_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    /** Public URL of the Jira site, e.g. https://acme.atlassian.net */
    siteUrl: text('site_url').notNull(),
    /** Cloud site ID returned by the Atlassian cloud API; null for Data Center. */
    cloudId: text('cloud_id'),
    /** 'oauth3lo' for Cloud OAuth 2.0; 'api_token' for Data Center. */
    authMethod: text('auth_method').notNull().default('oauth3lo'),
    /** OAuth scopes granted at consent time. */
    scopes: text('scopes').array().notNull().default([]),
    /** Opaque reference to the Secrets Manager secret holding the encrypted credential. */
    secretRef: text('secret_ref'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    /** 'pending' | 'active' | 'degraded' | 'revoked' */
    state: text('state').notNull().default('pending'),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    /**
     * Secrets Manager reference for the HMAC-SHA-256 webhook signing secret.
     * Generated at connection creation time. Null on old rows (pre-WO-054).
     */
    webhookSecretRef: text('webhook_secret_ref'),
    /**
     * When the webhook secret was last rotated. Used to enforce the 10-minute
     * overlap window during which both current and previous secrets are accepted.
     */
    webhookSecretRotatedAt: timestamp('webhook_secret_rotated_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('jira_connections_tenant_id_idx').on(t.tenantId),
    cloudIdIdx: uniqueIndex('jira_connections_cloud_id_uniq').on(t.cloudId),
  }),
);

export type JiraConnection = typeof jiraConnections.$inferSelect;
export type NewJiraConnection = typeof jiraConnections.$inferInsert;
export type JiraConnectionState = 'pending' | 'active' | 'degraded' | 'revoked';
export type JiraAuthMethod = 'oauth3lo' | 'api_token';
