/**
 * Fixtures for SLA reminder handler tests (WO-048).
 *
 * Provides:
 *  - SLA reminder event factories (sla.reminder_due, sla.breached)
 *  - SNS-wrapped envelope factory
 *  - Allow-listed and deny-listed webhook URL examples
 *  - Stubbed tenant notification channel configurations
 *  - Captured SES send double for assertions
 */

import type { SlaReminderEvent } from '../../src/handlers/sla-reminder.handler';

// ---------------------------------------------------------------------------
// Fixed UUIDs (deterministic across runs)
// ---------------------------------------------------------------------------

export const TENANT_ID   = 'a0000000-0000-0000-0000-000000000001';
export const TIMER_ID    = 'b0000000-0000-0000-0000-000000000001';
export const TICKET_ID   = 'c0000000-0000-0000-0000-000000000001';
export const ORG_ID      = 'd0000000-0000-0000-0000-000000000001';
export const EVENT_ID    = 'e0000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// SLA event factories
// ---------------------------------------------------------------------------

export function makeReminderDueEvent(overrides: Partial<SlaReminderEvent> = {}): SlaReminderEvent {
  return {
    eventType: 'sla.reminder_due',
    eventId: EVENT_ID,
    tenantId: TENANT_ID,
    timerId: TIMER_ID,
    ticketId: TICKET_ID,
    ticketKey: 'TKT-0042',
    clockType: 'response',
    thresholdPct: 50,
    targetAt: new Date(Date.now() + 3_600_000).toISOString(),
    remainingMs: 3_600_000,
    priority: 'P2',
    organizationId: ORG_ID,
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    ...overrides,
  };
}

export function makeBreachedEvent(overrides: Partial<SlaReminderEvent> = {}): SlaReminderEvent {
  return makeReminderDueEvent({
    eventType: 'sla.breached',
    thresholdPct: 100,
    remainingMs: 0,
    breachedAt: new Date().toISOString(),
    ...overrides,
  });
}

export function makeSecondThresholdEvent(): SlaReminderEvent {
  return makeReminderDueEvent({ thresholdPct: 75, remainingMs: 900_000 });
}

// ---------------------------------------------------------------------------
// SQS message factories
// ---------------------------------------------------------------------------

/** Raw SQS message body (direct, no SNS wrapper) */
export function makeRawSqsBody(event: SlaReminderEvent): string {
  return JSON.stringify(event);
}

/** SNS notification envelope wrapping the event (as SQS receives from SNS subscription) */
export function makeSnsWrappedBody(event: SlaReminderEvent): string {
  return JSON.stringify({
    Type: 'Notification',
    MessageId: 'sns-msg-0000000000001',
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:opsninja-events',
    Message: JSON.stringify(event),
    Timestamp: new Date().toISOString(),
    SignatureVersion: '1',
    Signature: 'EXAMPLE==',
    SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
    UnsubscribeURL: 'https://sns.us-east-1.amazonaws.com/unsubscribe',
    MessageAttributes: {
      eventType: { Type: 'String', Value: event.eventType },
    },
  });
}

export const MALFORMED_BODY = '{ not valid json }';

export const WRONG_EVENT_TYPE_BODY = JSON.stringify({
  eventType: 'ticket.created',
  tenantId: TENANT_ID,
});

// ---------------------------------------------------------------------------
// Webhook URL allow-list / deny-list
// ---------------------------------------------------------------------------

/** Passes SSRF validation — public HTTPS endpoint */
export const ALLOWED_WEBHOOK_URL = 'https://hooks.example.com/opsninja-sla';

/** Blocked — cloud metadata IP */
export const DENIED_WEBHOOK_URL_METADATA = 'https://169.254.169.254/latest/meta-data';

/** Blocked — RFC1918 */
export const DENIED_WEBHOOK_URL_RFC1918 = 'https://10.0.0.1/hook';

/** Blocked — loopback */
export const DENIED_WEBHOOK_URL_LOOPBACK = 'https://127.0.0.1/hook';

/** Blocked — IPv6 loopback */
export const DENIED_WEBHOOK_URL_IPV6_LOOPBACK = 'https://[::1]/hook';

/** Blocked — HTTP scheme */
export const DENIED_WEBHOOK_URL_HTTP = 'http://hooks.example.com/sla';

// ---------------------------------------------------------------------------
// Tenant notification channel config (stubbed for tests)
// ---------------------------------------------------------------------------

/** A tenant with email + webhook channels configured */
export const TENANT_CHANNEL_CONFIG = {
  email: {
    enabled: true,
    recipientEmail: 'oncall@example.com',
  },
  webhook: {
    enabled: true,
    url: ALLOWED_WEBHOOK_URL,
    signingKey: 'test-signing-key-0123456789abcdef',
  },
};

/** Webhook endpoint DB row as returned by the resolver query */
export function makeWebhookEndpointRow(overrides: {
  url?: string;
  secret_ciphertext?: string;
} = {}) {
  return {
    url: overrides.url ?? ALLOWED_WEBHOOK_URL,
    secret_ciphertext: overrides.secret_ciphertext ?? 'test-signing-key-0123456789abcdef',
  };
}

// ---------------------------------------------------------------------------
// Captured SES send double
// ---------------------------------------------------------------------------

export interface CapturedEmailSend {
  from: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  traceId?: string;
}

export type MockEmailSender = {
  sendEmail: jest.Mock<Promise<{ messageId: string }>, [{ from: string; to: string; subject: string; htmlBody: string; textBody: string; traceId?: string }]>;
  capturedCalls: () => CapturedEmailSend[];
};

export function createMockEmailSender(): MockEmailSender {
  const calls: CapturedEmailSend[] = [];
  const sendEmail = jest.fn(async (params: CapturedEmailSend) => {
    calls.push({ ...params });
    return { messageId: `ses-msg-${Date.now()}` };
  });
  return {
    sendEmail,
    capturedCalls: () => calls,
  };
}
