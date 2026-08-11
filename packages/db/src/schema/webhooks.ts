import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  customType,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── Custom types ──────────────────────────────────────────────────────────────

/** bytea column for encrypted secret blobs. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** text[] stored as Postgres text array. */
const textArray = customType<{ data: string[]; driverData: string[] }>({
  dataType() {
    return 'text[]';
  },
});

// ── Enums ─────────────────────────────────────────────────────────────────────

export const webhookEndpointStatusEnum = pgEnum('webhook_endpoint_status', [
  'active',
  'disabled',
  'auto_disabled',
  'deleted',
]);

// ── Table ─────────────────────────────────────────────────────────────────────

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    url: text('url').notNull(),
    description: text('description'),
    eventTypes: textArray('event_types').notNull(),
    status: webhookEndpointStatusEnum('status').notNull().default('active'),
    secretCiphertext: bytea('secret_ciphertext'),
    secretKeyVersion: integer('secret_key_version').notNull().default(1),
    previousSecretCiphertext: bytea('previous_secret_ciphertext'),
    previousSecretExpiresAt: timestamp('previous_secret_expires_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusIdx: index('webhook_endpoints_tenant_status_idx').on(t.tenantId, t.status),
    eventTypesNotEmpty: check(
      'webhook_endpoints_event_types_not_empty',
      sql`array_length(${t.eventTypes}, 1) > 0`,
    ),
  }),
);

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
export type WebhookEndpointStatus = typeof webhookEndpointStatusEnum.enumValues[number];
