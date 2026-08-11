import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'pending',
  'delivered',
  'failed',
  'dropped',
]);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull().defaultRandom(),
    endpointId: uuid('endpoint_id').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    attempt: integer('attempt').notNull().default(1),
    status: webhookDeliveryStatusEnum('status').notNull().default('pending'),
    httpStatus: integer('http_status'),
    latencyMs: integer('latency_ms'),
    requestHeadersMeta: jsonb('request_headers_meta'),
    responseSnippet: text('response_snippet'),
    errorCode: text('error_code'),
    // Stored for replay; contains the canonical event payload
    canonicalPayload: jsonb('canonical_payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    attemptUidx: uniqueIndex('webhook_deliveries_attempt_uidx').on(
      t.tenantId,
      t.endpointId,
      t.eventId,
      t.attempt,
    ),
    historyIdx: index('webhook_deliveries_history_idx').on(
      t.tenantId,
      t.endpointId,
      t.createdAt,
    ),
  }),
);

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type WebhookDeliveryStatus = typeof webhookDeliveryStatusEnum.enumValues[number];
