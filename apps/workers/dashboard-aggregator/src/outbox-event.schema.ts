/**
 * Shared outbox event Zod schema for dashboard-relevant events.
 *
 * The outbox drain publishes events from the transactional outbox in this
 * envelope format. eventId is the idempotency token for the dedup guard.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Base envelope (all events share this shape)
// ---------------------------------------------------------------------------

export const OutboxEventSchema = z.object({
  eventId: z.string().uuid(),
  tenantId: z.string().uuid(),
  aggregateType: z.string(),
  aggregateId: z.string().uuid(),
  eventType: z.string(),
  occurredAt: z.string(),
  traceparent: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
});

export type OutboxEvent = z.infer<typeof OutboxEventSchema>;

// ---------------------------------------------------------------------------
// Ticket event payloads
// ---------------------------------------------------------------------------

export const TicketCreatedPayload = z.object({
  ticketId: z.string().uuid(),
  tenantId: z.string().uuid(),
  priority: z.string(),
  status: z.string(),
  organizationId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
});

export const TicketPriorityChangedPayload = z.object({
  ticketId: z.string().uuid(),
  tenantId: z.string().uuid(),
  previousPriority: z.string(),
  newPriority: z.string(),
  organizationId: z.string().uuid(),
});

export const TicketStatusChangedPayload = z.object({
  ticketId: z.string().uuid(),
  tenantId: z.string().uuid(),
  previousStatus: z.string(),
  newStatus: z.string(),
  priority: z.string(),
  organizationId: z.string().uuid(),
});

export const TicketReopenedPayload = z.object({
  ticketId: z.string().uuid(),
  tenantId: z.string().uuid(),
  priority: z.string(),
  organizationId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// SLA event payloads
// ---------------------------------------------------------------------------

export const SlaTimerPayload = z.object({
  ticketId: z.string().uuid(),
  tenantId: z.string().uuid(),
  clockType: z.string(),
  nextFireAt: z.string().nullable().optional(),
});

export const SlaThresholdPayload = z.object({
  ticketId: z.string().uuid(),
  tenantId: z.string().uuid(),
  clockType: z.string(),
  thresholdPct: z.number(),
});

// ---------------------------------------------------------------------------
// AI event payloads
// ---------------------------------------------------------------------------

export const AiSynthesisCompletedPayload = z.object({
  ticketId: z.string().uuid(),
  tenantId: z.string().uuid(),
  aiStatus: z.string(),
  areaCount: z.number().optional(),
  affectedAreas: z
    .array(z.object({ areaLabel: z.string(), confidence: z.string() }))
    .optional(),
  modelId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Parse helper — unwraps SNS fan-out envelope if present
// ---------------------------------------------------------------------------

export function parseOutboxEvent(raw: string): OutboxEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // SNS wraps the real payload in a Message string field
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'Message' in parsed &&
    typeof (parsed as Record<string, unknown>)['Message'] === 'string'
  ) {
    try {
      parsed = JSON.parse((parsed as Record<string, unknown>)['Message'] as string);
    } catch {
      return null;
    }
  }
  const result = OutboxEventSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
