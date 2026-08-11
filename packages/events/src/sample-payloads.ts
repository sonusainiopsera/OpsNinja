/**
 * Committed sample webhook payloads per event type.
 *
 * These fixtures serve a dual purpose:
 *  1. Documentation examples — used by generate-webhook-catalogue.ts.
 *  2. Webhook signature-verification test corpus — reused by webhook delivery
 *     tests to prove that documented examples verify against the real signing
 *     implementation (WO-100 AC-12).
 *
 * All values are synthetic. No real tenant IDs, real domains, or real credentials.
 */

import { EVENT_REGISTRY } from './event-registry';
import type { CanonicalEventEnvelope } from './types';

export const SYNTHETIC_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const SYNTHETIC_EVENT_ID_PREFIX = '01910f2a-0000-7000-8000-';

/** Build a canonical event envelope from an example payload for testing. */
export function buildSampleEnvelope(eventType: string, overrides?: Partial<CanonicalEventEnvelope>): CanonicalEventEnvelope {
  const entry = EVENT_REGISTRY.find((e) => e.eventType === eventType);
  if (!entry) throw new Error(`No registry entry for event type: ${eventType}`);

  return {
    id: `${SYNTHETIC_EVENT_ID_PREFIX}${String(EVENT_REGISTRY.indexOf(entry) + 1).padStart(12, '0')}`,
    type: eventType,
    occurredAt: '2026-01-15T10:00:00.000Z',
    tenantId: SYNTHETIC_TENANT_ID,
    data: entry.examplePayload,
    ...overrides,
  };
}

/** All sample envelopes, one per registered event type. */
export const SAMPLE_ENVELOPES: readonly CanonicalEventEnvelope[] = EVENT_REGISTRY.map((entry) =>
  buildSampleEnvelope(entry.eventType),
);
