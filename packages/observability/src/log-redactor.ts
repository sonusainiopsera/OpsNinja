/**
 * Log redactor — strips Confidential-tier PII from structured log objects.
 *
 * Rules applied:
 *  1. RFC5322 email addresses anywhere in string values → REDACTED_EMAIL
 *  2. Keys named 'recipientEmail', 'to', 'email', 'rendered_body',
 *     'htmlBody', 'textBody', 'bodyTemplate' → value replaced with placeholder
 *
 * The redactor is a pure function and is safe to call in hot paths.
 * It does NOT mutate the input object.
 *
 * Tests: assert that NO captured log line contains an email address or body text.
 */

// RFC5322-compatible email regex (simplified but covers all common formats).
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/** Keys whose entire value should be replaced (not just emails found within). */
const REDACTED_KEYS = new Set([
  'recipientEmail',
  'recipient_email',
  'to',
  'email',
  'rendered_body',
  'htmlBody',
  'textBody',
  'bodyTemplate',
  'body_template',
  'text_template',
  'textTemplate',
  // Webhook Restricted-tier: signing secrets must never appear in logs.
  'secret',
  'plaintext',
  'signingKey',
  'signing_key',
  'secretCiphertext',
  'secret_ciphertext',
  'previousSecretCiphertext',
  'previous_secret_ciphertext',
  // Jira OAuth credential fields — Restricted-tier (WO-051).
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'code',
  'codeVerifier',
  'code_verifier',
  'clientSecret',
  'client_secret',
  'apiToken',
  'api_token',
  // CSAT Confidential-tier: free-text comment is respondent-identifying PII.
  'comment',
  'csatComment',
  'csat_comment',
]);

const REDACTED_EMAIL_PLACEHOLDER = '[REDACTED_EMAIL]';
const REDACTED_BODY_PLACEHOLDER = '[REDACTED_BODY]';

/** Redact email addresses from a single string value. */
export function redactEmailsInString(value: string): string {
  return value.replace(EMAIL_REGEX, REDACTED_EMAIL_PLACEHOLDER);
}

/**
 * Recursively redact PII from a log object.
 * Returns a new object; never mutates input.
 */
export function redactLogObject(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return redactEmailsInString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(redactLogObject);
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(key)) {
        result[key] = REDACTED_BODY_PLACEHOLDER;
      } else if (typeof value === 'string') {
        result[key] = redactEmailsInString(value);
      } else {
        result[key] = redactLogObject(value);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Serialize a log record to a redacted JSON string.
 * Safe to pass directly to console.log or any structured logger.
 */
export function toRedactedLogString(record: Record<string, unknown>): string {
  return JSON.stringify(redactLogObject(record));
}
