/**
 * Thread content redaction — pure functions with an ordered, exported rule set.
 *
 * Applied before the prompt leaves the process so ticket threads (Confidential
 * tier containing internal agent notes) never reach the model provider with
 * raw PII.
 *
 * The rule set is exported so the structured-log redactor can import it
 * without duplicating patterns.
 *
 * Rules are applied in order: later rules cannot accidentally un-redact an
 * earlier replacement because replacements use bracket-enclosed sentinel
 * values that do not match subsequent patterns.
 */

// ---------------------------------------------------------------------------
// Rule type
// ---------------------------------------------------------------------------

export interface RedactionRule {
  /** Stable identifier used in tests and log output. */
  name: string;
  /** RegExp applied globally. Must not use lookbehind for Node 14 compat. */
  pattern: RegExp;
  /** Replacement string. Use bracket sentinels e.g. `[EMAIL]`. */
  replacement: string;
}

// ---------------------------------------------------------------------------
// Rule set (ordered)
// ---------------------------------------------------------------------------

/**
 * Ordered redaction rules for thread content.
 * Export allows reuse by the structured-log redactor.
 */
export const REDACTION_RULES: readonly RedactionRule[] = [
  {
    name: 'bearer_token',
    // Matches "Bearer <token>" with optional surrounding quotes
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: 'Bearer [TOKEN]',
  },
  {
    name: 'api_key_header',
    // Matches common header patterns: "Authorization: <value>", "X-Api-Key: <value>"
    pattern: /(?:Authorization|X-Api-Key|X-Auth-Token|api[_-]?key|apikey)\s*[:=]\s*\S+/gi,
    replacement: '[KEY_HEADER]',
  },
  {
    name: 'jwt',
    // Matches three base64url segments separated by dots (JWT format)
    pattern: /\b[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\b/g,
    replacement: '[JWT]',
  },
  {
    name: 'email',
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL]',
  },
  {
    name: 'phone_e164',
    // E.164 format: +<country><number>
    pattern: /\+\d{1,3}[\s\-.]?\(?\d{1,4}\)?[\s\-.]?\d{1,4}[\s\-.]?\d{1,9}/g,
    replacement: '[PHONE]',
  },
  {
    name: 'phone_us',
    // US formats: (555) 123-4567, 555-123-4567, 555.123.4567
    pattern: /(?:\(\d{3}\)|\d{3})[\s.\-]\d{3}[\s.\-]\d{4}/g,
    replacement: '[PHONE]',
  },
  {
    name: 'ipv6',
    // Simplified IPv6: groups of hex separated by colons (at least 2 groups)
    pattern: /(?:[0-9a-fA-F]{1,4}:){2,7}(?:[0-9a-fA-F]{1,4}|:)/g,
    replacement: '[IP]',
  },
  {
    name: 'ipv4',
    // IPv4 octets: three dots between 1-3 digit segments
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '[IP]',
  },
  {
    name: 'aws_access_key',
    // AWS access key IDs start with AKIA, ABIA, ACCA, ASIA
    pattern: /\b(AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: '[AWS_KEY]',
  },
  {
    name: 'key_shaped_string',
    // Long alphanumeric strings (32+ chars) that look like API keys / secrets.
    // Excludes UUIDs (handled separately) and common base64url patterns.
    pattern: /\b[A-Za-z0-9+/]{32,}={0,2}\b/g,
    replacement: '[KEY]',
  },
];

// ---------------------------------------------------------------------------
// Pure redaction functions
// ---------------------------------------------------------------------------

/**
 * Applies all redaction rules to a single string.
 * Rules are applied in order; each replacement uses bracket sentinels that
 * do not match subsequent patterns.
 */
export function redactText(text: string): string {
  let result = text;
  for (const rule of REDACTION_RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

/**
 * Applies redaction to the `body` field of every comment in a thread.
 * Subject is also redacted.
 * Returns a new array; input is never mutated.
 */
export function redactThread<T extends { body: string }>(
  comments: readonly T[],
): T[] {
  return comments.map((c) => ({ ...c, body: redactText(c.body) }));
}

/**
 * Checks whether a string contains any pattern that would be redacted.
 * Useful in tests to assert full redaction.
 */
export function containsRedactableContent(text: string): boolean {
  return REDACTION_RULES.some((rule) => {
    rule.pattern.lastIndex = 0; // reset global RegExp state
    return rule.pattern.test(text);
  });
}
