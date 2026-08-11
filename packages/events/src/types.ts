/**
 * Shared type definitions for the canonical webhook event envelope.
 *
 * This shape must match the serialisation produced by
 * packages/webhooks/src/canonical-payload.ts (CanonicalEvent).
 */

export interface CanonicalEventEnvelope {
  /** Unique event ID (UUID). */
  id: string;
  /** Dot-namespaced event type, e.g. "ticket.created". */
  type: string;
  /** ISO 8601 timestamp of when the event occurred. */
  occurredAt: string;
  /** Tenant identifier. */
  tenantId: string;
  /** Event-type-specific data object. */
  data: Record<string, unknown>;
}
