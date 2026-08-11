/**
 * Canonical payload serialiser for OpsNinja webhook events.
 *
 * Deterministic stable-key JSON: keys are sorted recursively so the signed
 * bytes and the transmitted bytes are identical regardless of the order in
 * which properties were attached to the source object.
 *
 * The canonical shape is:
 *   { id, type, occurredAt, tenantId, data }
 *
 * All keys in `data` are also sorted recursively so the serialisation is
 * stable across different JavaScript runtimes and object construction orders.
 *
 * IMPORTANT: the raw output of canonicalStringify is what gets signed and
 * transmitted. Any transformation after this point (re-serialise, parse+re-
 * stringify) would break receiver signature verification and is prohibited.
 */

export interface CanonicalEvent {
  id: string;
  type: string;
  occurredAt: string;
  tenantId: string;
  data: Record<string, unknown>;
}

/**
 * Recursively sort object keys for stable serialisation.
 * Arrays are left in insertion order (ordering is semantically meaningful).
 */
function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Produce a deterministic JSON string with stable key order.
 * This is the function that MUST be used for both signing and transmission.
 */
export function canonicalStringify(event: CanonicalEvent): string {
  const canonical: CanonicalEvent = {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    tenantId: event.tenantId,
    data: sortKeys(event.data) as Record<string, unknown>,
  };
  return JSON.stringify(canonical);
}

/**
 * Build a CanonicalEvent from raw event fields.
 */
export function buildCanonicalEvent(
  eventId: string,
  eventType: string,
  tenantId: string,
  occurredAt: Date,
  data: Record<string, unknown>,
): CanonicalEvent {
  return {
    id: eventId,
    type: eventType,
    occurredAt: occurredAt.toISOString(),
    tenantId,
    data,
  };
}
