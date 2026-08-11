import { z } from 'zod';

export const WebhookDeliveryEnvelopeSchema = z.object({
  version: z.literal('1'),
  type: z.literal('webhook_delivery'),
  data: z.object({
    tenantId: z.string().uuid(),
    endpointId: z.string().uuid(),
    eventId: z.string().uuid(),
    eventType: z.string().min(1).max(128),
    occurredAt: z.string(),
    attempt: z.number().int().min(1).max(10).default(1),
    data: z.record(z.unknown()).default({}),
    traceId: z.string().optional(),
  }),
});

export type WebhookDeliveryEnvelope = z.infer<typeof WebhookDeliveryEnvelopeSchema>;

export function parseEnvelope(sqsBody: string): WebhookDeliveryEnvelope {
  const parsed = JSON.parse(sqsBody);
  return WebhookDeliveryEnvelopeSchema.parse(parsed);
}
