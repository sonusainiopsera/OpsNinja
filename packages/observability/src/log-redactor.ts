/**
 * LogRedactor – strips Confidential-tier PII from structured log records.
 *
 * Applied as a transport-level transform before any log entry leaves the
 * process boundary (stdout, CloudWatch, OpenTelemetry exporter).
 *
 * Current redaction rules:
 *  - RFC 5322 email addresses → [REDACTED_EMAIL]
 *  - E.164 / national phone numbers → [REDACTED_PHONE]
 *  - IPv4 and IPv6 addresses → [REDACTED_IP]
 *  - Fields named recipientEmail, email, phone, ipAddress, rawIp,
 *    renderedBody, bodyHtml, free-text comment bodies → [REDACTED]
 *  - Any value matching the email/phone/IP pattern anywhere in a nested payload
 */

/** Matches standard email addresses (RFC 5321 simplified). */
const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/** Matches common phone number formats (E.164, national with spaces/dashes). */
const PHONE_PATTERN = /(?:\+?[0-9]{1,3}[-.\s]?)?(?:\(?[0-9]{2,4}\)?[-.\s]?){2,}[0-9]{3,4}/g;

/** Matches IPv4 addresses. */
const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;

/** Matches IPv6 addresses (simplified — catches the common forms). */
const IPV6_PATTERN = /(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}/g;

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
  // Phone
  'phone',
  'phoneNumber',
  'phone_number',
  'mobile',
  'mobileNumber',
  'mobile_number',
  // IP
  'ip',
  'ipAddress',
  'ip_address',
  'rawIp',
  'raw_ip',
  'clientIp',
  'client_ip',
  'remoteAddress',
  'remote_address',
  // Free-text bodies
  'comment',
  'body',
  'message',
  'description',
  'freeText',
  'free_text',
  // OAuth / credential material
  'token',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'api_token',
  'apiToken',
  'code',
  'code_verifier',
  'codeVerifier',
  'client_secret',
  'clientSecret',
  'state',
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
      let redacted = val;
      EMAIL_PATTERN.lastIndex = 0;
      if (EMAIL_PATTERN.test(redacted)) {
        EMAIL_PATTERN.lastIndex = 0;
        redacted = redacted.replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
      }
      EMAIL_PATTERN.lastIndex = 0;
      PHONE_PATTERN.lastIndex = 0;
      if (PHONE_PATTERN.test(redacted)) {
        PHONE_PATTERN.lastIndex = 0;
        redacted = redacted.replace(PHONE_PATTERN, '[REDACTED_PHONE]');
      }
      PHONE_PATTERN.lastIndex = 0;
      IPV4_PATTERN.lastIndex = 0;
      if (IPV4_PATTERN.test(redacted)) {
        IPV4_PATTERN.lastIndex = 0;
        redacted = redacted.replace(IPV4_PATTERN, '[REDACTED_IP]');
      }
      IPV4_PATTERN.lastIndex = 0;
      IPV6_PATTERN.lastIndex = 0;
      if (IPV6_PATTERN.test(redacted)) {
        IPV6_PATTERN.lastIndex = 0;
        redacted = redacted.replace(IPV6_PATTERN, '[REDACTED_IP]');
      }
      IPV6_PATTERN.lastIndex = 0;
      if (redacted !== val) {
        (obj as Record<string, unknown>)[String(key)] = redacted;
      }
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

/**
 * Returns true if the string contains a phone number pattern.
 */
export function containsPhone(input: string): boolean {
  PHONE_PATTERN.lastIndex = 0;
  const found = PHONE_PATTERN.test(input);
  PHONE_PATTERN.lastIndex = 0;
  return found;
}

/**
 * Returns true if the string contains an IP address.
 */
export function containsIp(input: string): boolean {
  IPV4_PATTERN.lastIndex = 0;
  const foundV4 = IPV4_PATTERN.test(input);
  IPV4_PATTERN.lastIndex = 0;
  if (foundV4) return true;
  IPV6_PATTERN.lastIndex = 0;
  const foundV6 = IPV6_PATTERN.test(input);
  IPV6_PATTERN.lastIndex = 0;
  return foundV6;
}

/**
 * Redacts phone numbers from a string.
 */
export function redactPhone(input: string): string {
  PHONE_PATTERN.lastIndex = 0;
  const result = input.replace(PHONE_PATTERN, '[REDACTED_PHONE]');
  PHONE_PATTERN.lastIndex = 0;
  return result;
}

/**
 * Redacts IP addresses (v4 and v6) from a string.
 */
export function redactIp(input: string): string {
  IPV4_PATTERN.lastIndex = 0;
  let result = input.replace(IPV4_PATTERN, '[REDACTED_IP]');
  IPV4_PATTERN.lastIndex = 0;
  IPV6_PATTERN.lastIndex = 0;
  result = result.replace(IPV6_PATTERN, '[REDACTED_IP]');
  IPV6_PATTERN.lastIndex = 0;
  return result;
}
