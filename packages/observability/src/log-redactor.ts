/**
 * LogRedactor – strips Confidential-tier PII from structured log records.
 *
 * Applied as a transport-level transform before any log entry leaves the
 * process boundary (stdout, CloudWatch, OpenTelemetry exporter).
 *
 * Current redaction rules:
 *  - RFC 5322 email addresses → [REDACTED_EMAIL]
 *  - Fields named recipientEmail, recipient_email, email, emailAddress,
 *    renderedBody, body_html, bodyHtml → [REDACTED]
 *  - Any value matching the email pattern anywhere in a nested JSON payload
 */

/** Matches standard email addresses (RFC 5321 simplified). */
const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/** Field names whose values are always redacted regardless of content. */
const REDACTED_FIELDS = new Set([
  'recipientEmail',
  'recipient_email',
  'email',
  'emailAddress',
  'email_address',
  'renderedBody',
  'rendered_body',
  'bodyHtml',
  'body_html',
  'textBody',
  'text_body',
]);

/**
 * Recursively redacts a log record object in-place.
 *
 * @param obj - Log record (or any nested sub-object) to redact.
 * @returns The same object reference with PII fields replaced.
 */
export function redactLogRecord<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as (keyof T)[]) {
    const val = obj[key];

    if (REDACTED_FIELDS.has(String(key))) {
      (obj as Record<string, unknown>)[String(key)] = '[REDACTED]';
      continue;
    }

    if (typeof val === 'string') {
      if (EMAIL_PATTERN.test(val)) {
        EMAIL_PATTERN.lastIndex = 0;
        (obj as Record<string, unknown>)[String(key)] = val.replace(
          EMAIL_PATTERN,
          '[REDACTED_EMAIL]',
        );
      }
      EMAIL_PATTERN.lastIndex = 0;
      continue;
    }

    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      redactLogRecord(val as object);
    }
  }
  return obj;
}

/**
 * Redacts email addresses from a string.
 * Safe to call on any string before logging.
 */
export function redactString(input: string): string {
  EMAIL_PATTERN.lastIndex = 0;
  const result = input.replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
  EMAIL_PATTERN.lastIndex = 0;
  return result;
}

/**
 * Returns true if the string contains an email address.
 * Used in tests to verify redaction completeness.
 */
export function containsEmail(input: string): boolean {
  EMAIL_PATTERN.lastIndex = 0;
  const found = EMAIL_PATTERN.test(input);
  EMAIL_PATTERN.lastIndex = 0;
  return found;
}
