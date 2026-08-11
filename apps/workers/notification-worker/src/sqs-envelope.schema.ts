/**
 * Zod schema for the qNotify SQS message envelope.
 *
 * All SQS payloads are untrusted input and must be parsed before use.
 * Invalid envelopes are rejected immediately — no partial processing.
 */

import { z } from 'zod';

export const NotificationEnvelopeSchema = z.object({
  version: z.literal('1'),
  type: z.literal('notification'),
  data: z.object({
    tenantId: z.string().uuid(),
    /** Stable idempotency key — SHA-256 of (outbox_event_id + recipient_email). */
    dedupeKey: z.string().min(1).max(500),
    templateKey: z.string().min(1).max(200),
    channel: z.enum(['email']).default('email'),
    recipientEmail: z.string().email(),
    recipientContactId: z.string().uuid().optional(),
    ticketId: z.string().uuid().optional(),
    locale: z.string().min(2).max(10).default('en'),
    /** Arbitrary template variables — validated against template manifest at render time. */
    payload: z.record(z.unknown()),
    /** Originating outbox event trace ID for span correlation. */
    outboxTraceId: z.string().optional(),
  }),
});

export type NotificationEnvelope = z.infer<typeof NotificationEnvelopeSchema>;

/** Parse and validate a raw SQS message body string. */
export function parseEnvelope(body: string): NotificationEnvelope {
  const raw: unknown = JSON.parse(body);
  return NotificationEnvelopeSchema.parse(raw);
}

// SES bounce/complaint SNS event schema
export const SesEventEnvelopeSchema = z.object({
  notificationType: z.enum(['Bounce', 'Complaint', 'Delivery']),
  bounce: z
    .object({
      bounceType: z.string(),
      bouncedRecipients: z.array(
        z.object({ emailAddress: z.string() }),
      ),
    })
    .optional(),
  complaint: z
    .object({
      complainedRecipients: z.array(
        z.object({ emailAddress: z.string() }),
      ),
    })
    .optional(),
  mail: z.object({ tags: z.record(z.array(z.string())).optional() }).optional(),
});

export type SesEventEnvelope = z.infer<typeof SesEventEnvelopeSchema>;
