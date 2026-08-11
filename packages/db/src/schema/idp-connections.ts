/**
 * IdP connection schema — per-tenant OIDC provider configuration.
 *
 * client_secret_ref is a reference into Secrets Manager (never the raw secret).
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

export const idpConnections = pgTable(
  'idp_connections',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    id: uuid('id').notNull().defaultRandom(),
    issuer: text('issuer').notNull(),
    clientId: text('client_id').notNull(),
    clientSecretRef: text('client_secret_ref').notNull(),
    scopes: text('scopes').array().notNull(),
    allowedEmailDomains: text('allowed_email_domains').array().notNull(),
    redirectUri: text('redirect_uri').notNull(),
    jwksUri: text('jwks_uri'),
    discoveryUrl: text('discovery_url'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

export type IdpConnection = typeof idpConnections.$inferSelect;
export type NewIdpConnection = typeof idpConnections.$inferInsert;
