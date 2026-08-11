/**
 * Webhook endpoint schema — tenant-scoped outbound webhook registry.
 *
 * webhook_endpoints: signed outbound URL subscriptions per tenant.
 * Secrets are stored envelope-encrypted (ciphertext + key version).
 * Previous secret retained during rotation grace window.
 * Auto-disable via consecutive_failures counter written by the delivery worker.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export type WebhookEndpointStatus = 'active' | 'disabled' | 'auto_disabled' | 'deleted';

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    // Composite leading PK: tenant_id first for RLS plan efficiency.
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').defaultRandom().notNull(),

    url: text('url').notNull(),
    description: text('description'),
    /** Array of subscribed event type strings (e.g. 'ticket.created'). */
    eventTypes: text('event_types').array().notNull(),

    status: text('status')
      .$type<WebhookEndpointStatus>()
      .notNull()
      .default('active'),

    /** Encrypted signing secret ciphertext (Base64). */
    secretCiphertext: text('secret_ciphertext').notNull(),
    /** KMS data-key version used when encrypting secretCiphertext. */
    secretKeyVersion: integer('secret_key_version').notNull().default(1),

    /** Previous secret ciphertext retained during rotation grace window. */
    previousSecretCiphertext: text('previous_secret_ciphertext'),
    /** UTC timestamp after which previousSecretCiphertext is no longer valid. */
    previousSecretExpiresAt: timestamp('previous_secret_expires_at', { withTimezone: true }),

    /** Written by the delivery worker on each consecutive failure. */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),

    /** Actor user id who created this endpoint. */
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /** Soft-delete timestamp for drain grace window. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    pk: uniqueIndex('webhook_endpoints_pk').on(t.tenantId, t.id),
    statusIdx: index('webhook_endpoints_tenant_status_idx').on(t.tenantId, t.status),
    tenantIdx: index('webhook_endpoints_tenant_id_idx').on(t.tenantId),
  }),
);

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
