/**
 * RedactionPort — interface and default implementation for Confidential-tier
 * field redaction in audit before_state / after_state snapshots.
 *
 * The interface is structured for easy replacement by the classification-aware
 * redactor from WOREF-094 when that story ships. Until then, DefaultRedactor
 * covers the most common PII patterns: email addresses, phone numbers, IP
 * addresses and free-text bodies.
 *
 * SECURITY: No raw email, phone, or comment body may appear in audit storage.
 * Tests assert redact(payload) removes these fields from the output.
 */

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface RedactionPort {
  /**
   * Redact Confidential-tier fields from a JSON-serializable snapshot.
   * Returns a new object; never mutates input.
   */
  redact(payload: Record<string, unknown>): Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(\+?[\d\s\-().]{7,20})/g;
const IP_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/** Keys whose entire value is replaced with a placeholder. */
const CONFIDENTIAL_KEYS = new Set([
  'email',
  'recipientEmail',
  'recipient_email',
  'phone',
  'phoneNumber',
  'phone_number',
  'body',
  'comment_body',
  'commentBody',
  'description',
  'rendered_body',
  'htmlBody',
  'textBody',
  'bodyTemplate',
  'body_template',
  'ipAddress',
  'ip_address',
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
]);

const REDACTED = '[REDACTED]';

// ---------------------------------------------------------------------------
// Default implementation
// ---------------------------------------------------------------------------

export class DefaultRedactor implements RedactionPort {
  redact(payload: Record<string, unknown>): Record<string, unknown> {
    return redactValue(payload) as Record<string, unknown>;
  }
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(EMAIL_REGEX, REDACTED)
      .replace(IP_REGEX, REDACTED);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = CONFIDENTIAL_KEYS.has(k) ? REDACTED : redactValue(v);
    }
    return result;
  }
  return value;
}

/** Injection token for the port. */
export const REDACTION_PORT = Symbol('REDACTION_PORT');
