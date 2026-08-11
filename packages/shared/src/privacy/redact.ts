/**
 * PII redaction policy shared between the audit trail and the structured
 * logger, so both surfaces apply identical data-classification rules.
 *
 * Classification tiers:
 *   Confidential — personally-identifiable or sensitive content that must
 *     be fully removed before persistence (replaced with '[REDACTED]').
 *     Examples: email addresses, comment bodies, portal passwords.
 *
 *   Restricted — credentials and tokens that must never be logged or stored;
 *     replaced with a SHA-256 hash so the value remains dedupe-able without
 *     being recoverable.
 *     Examples: API tokens, webhook secrets, OAuth credentials.
 *
 * The allow-list of field names is authoritative: adding a new PII field
 * requires updating this file, making the classification policy auditable.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Classification tables
// ---------------------------------------------------------------------------

/** Fields fully replaced with '[REDACTED]'. */
const CONFIDENTIAL_FIELDS = new Set([
  'email',
  'contactEmail',
  'requesterEmail',
  'body',               // ticket comment bodies
  'commentBody',
  'note',
  'internalNote',
  'message',
  'description',
  'subject',            // ticket subjects may contain PII
  'name',
  'contactName',
  'displayName',
  'cruxSummary',        // AI synthesis — Confidential tier
  'resolutionSummary',  // AI synthesis — Confidential tier
  'crux_summary',       // snake_case variants from DB row objects
  'resolution_summary',
]);

/** Fields replaced with a SHA-256 hex hash of their string representation. */
const RESTRICTED_FIELDS = new Set([
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'webhookSecret',
  'signingSecret',
  'password',
  'credential',
  'privateKey',
  'clientSecret',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const REDACTED_SENTINEL = '[REDACTED]';
export const HASHED_PREFIX = '[SHA256:';

/**
 * Redacts PII from a plain object by applying the classification policy to
 * every key at every nesting level. Returns a new deep-copied object; the
 * original is never mutated.
 *
 * @param obj - Any JSON-serialisable object or primitive.
 * @returns   - A copy with Confidential fields replaced by '[REDACTED]' and
 *              Restricted fields replaced by '[SHA256:<hex>]'.
 */
export function redact(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redact(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (CONFIDENTIAL_FIELDS.has(key)) {
      result[key] = REDACTED_SENTINEL;
    } else if (RESTRICTED_FIELDS.has(key)) {
      result[key] = hashValue(value);
    } else if (value !== null && typeof value === 'object') {
      result[key] = redact(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Returns true if the key is classified as Confidential or Restricted.
 */
export function isClassifiedField(key: string): boolean {
  return CONFIDENTIAL_FIELDS.has(key) || RESTRICTED_FIELDS.has(key);
}

/**
 * Returns the classification tier for a field name.
 */
export function classifyField(key: string): 'confidential' | 'restricted' | 'public' {
  if (CONFIDENTIAL_FIELDS.has(key)) return 'confidential';
  if (RESTRICTED_FIELDS.has(key)) return 'restricted';
  return 'public';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hashValue(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  const hash = createHash('sha256').update(str).digest('hex');
  return `${HASHED_PREFIX}${hash}]`;
}
