/**
 * PII redactor for structured logs.
 *
 * Strips or hashes known PII keys before log records are emitted.
 * Applied as a serializer in the application logger configuration.
 *
 * Policy:
 *   - email, phone, ip, ipAddress, rawIp → SHA-256 truncated to 12 hex chars
 *     so correlation is preserved without exposing the raw value.
 *   - Free-text / comment fields → replaced with the string '[REDACTED]'.
 *   - All other fields pass through unchanged.
 *   - Keys are matched case-insensitively.
 */

import { createHash } from 'crypto';

/** Keys whose values are hashed to short digests for correlation. */
const HASH_KEYS = new Set([
  'email',
  'phone',
  'phonenumber',
  'ip',
  'ipaddress',
  'rawip',
  'remoteaddress',
  'clientip',
]);

/** Keys whose values are replaced with '[REDACTED]'. */
const REDACT_KEYS = new Set([
  'comment',
  'body',
  'message',
  'description',
  'note',
  'freetext',
  'free_text',
  'content',
  'subject',
]);

function shortHash(value: string): string {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function redactValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const lower = key.toLowerCase();
  if (HASH_KEYS.has(lower)) {
    return `[hashed:${shortHash(String(value))}]`;
  }
  if (REDACT_KEYS.has(lower)) {
    return '[REDACTED]';
  }
  return value;
}

/**
 * Recursively redact PII from a log record object.
 * Returns a new object — the original is not mutated.
 */
export function redactPii(record: unknown, depth = 0): unknown {
  if (depth > 8) return record; // guard against circular / deeply nested structures
  if (Array.isArray(record)) {
    return record.map((item) => redactPii(item, depth + 1));
  }
  if (record !== null && typeof record === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(record as Record<string, unknown>)) {
      out[key] = redactValue(key, typeof val === 'object' ? redactPii(val, depth + 1) : val);
    }
    return out;
  }
  return record;
}

/**
 * Logger serializer compatible with pino/winston serializers.
 * Pass this as the value of loggerOptions.serializers.req or as a
 * general record transformer.
 */
export function piiSerializer(record: Record<string, unknown>): Record<string, unknown> {
  return redactPii(record) as Record<string, unknown>;
}
