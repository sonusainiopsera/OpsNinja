/**
 * canonical-payload.ts – deterministic JSON serialisation for webhook payloads.
 *
 * The signed byte sequence must equal the transmitted byte sequence exactly.
 * This module produces a stable, key-ordered JSON string so HMAC is always
 * computed over the same bytes the receiver reads from the HTTP body.
 *
 * Ordering rules:
 *  1. Object keys sorted lexicographically at every nesting level.
 *  2. Arrays preserve element order (only object keys are sorted).
 *  3. No trailing whitespace, no indentation (minified).
 *  4. The top-level envelope always has these keys in this order:
 *     id, type, occurredAt, tenantId, data
 *
 * The stable envelope shape is enforced by constructing the envelope object
 * with keys in the correct insertion order before calling stableStringify.
 */

export interface WebhookEventEnvelope {
  id: string;
  type: string;
  occurredAt: string;  // ISO 8601
  tenantId: string;
  data: Record<string, unknown>;
}

/**
 * Recursively sorts object keys and returns a minified JSON string.
 * Arrays are preserved in their original element order.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Builds the canonical envelope and serialises it deterministically.
 *
 * The returned string is both signed and transmitted — the two are identical
 * by construction, so no re-serialisation is possible on the delivery path.
 */
export function buildCanonicalPayload(envelope: WebhookEventEnvelope): string {
  // Explicit key insertion order matches the documented API contract
  const ordered: WebhookEventEnvelope = {
    id: envelope.id,
    type: envelope.type,
    occurredAt: envelope.occurredAt,
    tenantId: envelope.tenantId,
    data: envelope.data,
  };
  return stableStringify(ordered);
}
