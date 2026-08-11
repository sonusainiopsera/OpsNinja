import {
  pgTable,
  uuid,
  text,
  timestamp,
  smallint,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dropped';

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').defaultRandom().notNull(),
    endpointId: uuid('endpoint_id').notNull(),
    eventId: uuid('event_id').notNull(),
    eventType: text('event_type').notNull(),
    attempt: smallint('attempt').notNull().default(1),
    status: text('status').$type<WebhookDeliveryStatus>().notNull().default('pending'),
    httpStatus: smallint('http_status'),
    latencyMs: integer('latency_ms'),
    requestHeadersMeta: jsonb('request_headers_meta'),
    responseSnippet: text('response_snippet'),
    errorCode: text('error_code'),
    canonicalPayload: jsonb('canonical_payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    attemptUniq: uniqueIndex('webhook_deliveries_attempt_uniq').on(
      t.tenantId,
      t.endpointId,
      t.eventId,
      t.attempt,
    ),
    tenantEndpointCreatedIdx: index('webhook_deliveries_tenant_endpoint_created_idx').on(
      t.tenantId,
      t.endpointId,
      t.createdAt,
    ),
    tenantEventIdx: index('webhook_deliveries_tenant_event_idx').on(t.tenantId, t.eventId),
  }),
);

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
