/**
 * Test fixtures for webhook worker unit tests.
 *
 * Provides endpoint fixtures in active, rotating, and auto_disabled states,
 * and SQS message fixtures for standard delivery scenarios.
 */

// ── Shared UUIDs ────────────────────────────────────────────────────────────
export const TENANT_ID = '10000000-0000-0000-0000-000000000001';
export const ENDPOINT_ID_ACTIVE = '20000000-0000-0000-0000-000000000001';
export const ENDPOINT_ID_ROTATING = '20000000-0000-0000-0000-000000000002';
export const ENDPOINT_ID_DISABLED = '20000000-0000-0000-0000-000000000003';
export const EVENT_ID = '30000000-0000-0000-0000-000000000001';

// ── Endpoint fixtures ───────────────────────────────────────────────────────

/** Active endpoint with a single current secret. */
export const FIXTURE_ENDPOINT_ACTIVE = {
  id: ENDPOINT_ID_ACTIVE,
  tenantId: TENANT_ID,
  url: 'https://receiver.example.com/webhook',
  status: 'active' as const,
  secretCiphertext: 'AQICAHi...encrypted-base64==',
  previousSecretCiphertext: null,
  eventTypes: ['ticket.created', 'ticket.resolved'],
  consecutiveFailures: 0,
  autoDisableThreshold: 20,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
};

/**
 * Endpoint in rotation grace window — both current and previous secrets present.
 * Worker must emit dual v1= signatures.
 */
export const FIXTURE_ENDPOINT_ROTATING = {
  id: ENDPOINT_ID_ROTATING,
  tenantId: TENANT_ID,
  url: 'https://receiver-b.example.com/webhook',
  status: 'active' as const,
  secretCiphertext: 'AQICAHi...new-secret-encrypted==',
  previousSecretCiphertext: 'AQICAHi...old-secret-encrypted==',
  eventTypes: ['ticket.created'],
  consecutiveFailures: 3,
  autoDisableThreshold: 20,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-02-01T00:00:00Z'),
  deletedAt: null,
};

/**
 * Auto-disabled endpoint — delivery handler should record 'dropped'
 * without making an HTTP request.
 */
export const FIXTURE_ENDPOINT_AUTO_DISABLED = {
  id: ENDPOINT_ID_DISABLED,
  tenantId: TENANT_ID,
  url: 'https://receiver-c.example.com/webhook',
  status: 'auto_disabled' as const,
  secretCiphertext: 'AQICAHi...encrypted-base64==',
  previousSecretCiphertext: null,
  eventTypes: ['ticket.created'],
  consecutiveFailures: 20,
  autoDisableThreshold: 20,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-03-01T00:00:00Z'),
  deletedAt: null,
};

// ── SQS message fixtures ────────────────────────────────────────────────────

/** Standard first-attempt delivery envelope (active endpoint). */
export const FIXTURE_SQS_MESSAGE_ATTEMPT_1 = {
  MessageId: 'sqs-msg-00000001',
  ReceiptHandle: 'receipt-handle-00000001',
  Body: JSON.stringify({
    version: '1',
    type: 'webhook_delivery',
    data: {
      tenantId: TENANT_ID,
      endpointId: ENDPOINT_ID_ACTIVE,
      eventId: EVENT_ID,
      eventType: 'ticket.created',
      occurredAt: '2026-01-15T12:00:00.000Z',
      attempt: 1,
      data: {
        ticketId: '40000000-0000-0000-0000-000000000001',
        subject: 'Test ticket',
        priority: 'P1',
      },
      traceId: 'trace-00000001',
    },
  }),
};

/** Retry attempt 3 — worker receives this after two prior failures. */
export const FIXTURE_SQS_MESSAGE_ATTEMPT_3 = {
  MessageId: 'sqs-msg-00000002',
  ReceiptHandle: 'receipt-handle-00000002',
  Body: JSON.stringify({
    version: '1',
    type: 'webhook_delivery',
    data: {
      tenantId: TENANT_ID,
      endpointId: ENDPOINT_ID_ACTIVE,
      eventId: EVENT_ID,
      eventType: 'ticket.created',
      occurredAt: '2026-01-15T12:00:00.000Z',
      attempt: 3,
      data: {
        ticketId: '40000000-0000-0000-0000-000000000001',
        subject: 'Test ticket',
        priority: 'P1',
      },
      traceId: 'trace-00000001',
    },
  }),
};

/** Final attempt (6) — next failure routes to DLQ. */
export const FIXTURE_SQS_MESSAGE_ATTEMPT_6 = {
  MessageId: 'sqs-msg-00000003',
  ReceiptHandle: 'receipt-handle-00000003',
  Body: JSON.stringify({
    version: '1',
    type: 'webhook_delivery',
    data: {
      tenantId: TENANT_ID,
      endpointId: ENDPOINT_ID_ACTIVE,
      eventId: EVENT_ID,
      eventType: 'ticket.resolved',
      occurredAt: '2026-01-15T13:00:00.000Z',
      attempt: 6,
      data: {
        ticketId: '40000000-0000-0000-0000-000000000001',
        resolutionMinutes: 60,
      },
      traceId: 'trace-00000002',
    },
  }),
};

/** Envelope targeting a rotating-secret endpoint. */
export const FIXTURE_SQS_MESSAGE_ROTATING_ENDPOINT = {
  MessageId: 'sqs-msg-00000004',
  ReceiptHandle: 'receipt-handle-00000004',
  Body: JSON.stringify({
    version: '1',
    type: 'webhook_delivery',
    data: {
      tenantId: TENANT_ID,
      endpointId: ENDPOINT_ID_ROTATING,
      eventId: '30000000-0000-0000-0000-000000000002',
      eventType: 'ticket.created',
      occurredAt: '2026-01-15T12:00:00.000Z',
      attempt: 1,
      data: { ticketId: '40000000-0000-0000-0000-000000000002' },
    },
  }),
};
