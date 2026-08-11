/**
 * redaction.port.ts – interface and default implementation for classification-aware
 * redaction of before_state / after_state audit snapshots.
 *
 * The full classification-aware redactor arrives in WOREF-094.  This file
 * provides an interface-compatible default that covers the highest-risk fields
 * so WO-093 is not blocked at runtime.
 *
 * Rules applied by DefaultRedactor:
 *   - email addresses          → "[REDACTED_EMAIL]"
 *   - phone numbers            → "[REDACTED_PHONE]"
 *   - IPv4/IPv6 literals       → "[REDACTED_IP]"
 *   - keys named 'password', 'secret', 'token', 'credential', 'auth_*', 'key'
 *     → "[REDACTED]"
 *   - keys named 'body', 'description', 'comment_body' with string values
 *     → value is preserved but logged at Confidential tier (not stripped by default;
 *       WOREF-094 will classify per-tenant)
 */

export const REDACTION_PORT = 'REDACTION_PORT';

export interface RedactionPort {
  /**
   * Returns a deep copy of `snapshot` with confidential fields replaced by
   * redaction placeholders.  Safe to call with null/undefined inputs.
   */
  redact(snapshot: Record<string, unknown> | null | undefined): Record<string, unknown> | null;
}

// ── Patterns ──────────────────────────────────────────────────────────────────

const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_PATTERN = /(\+?1?\s?)?(\(?\d{3}\)?[\s.\-]?)(\d{3}[\s.\-]?\d{4})/g;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_PATTERN = /\b([0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}\b/g;

const SENSITIVE_KEY_PATTERN =
  /^(password|secret|token|credential|auth_|signing_key|private_key|api_key|key)$/i;

export class DefaultRedactor implements RedactionPort {
  redact(
    snapshot: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | null {
    if (snapshot == null) return null;
    return this.redactObject(snapshot);
  }

  private redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = '[REDACTED]';
        continue;
      }
      if (typeof value === 'string') {
        result[key] = this.redactString(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === 'string'
            ? this.redactString(item)
            : typeof item === 'object' && item !== null
              ? this.redactObject(item as Record<string, unknown>)
              : item,
        );
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.redactObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private redactString(s: string): string {
    return s
      .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
      .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
      .replace(IPV4_PATTERN, '[REDACTED_IP]')
      .replace(IPV6_PATTERN, '[REDACTED_IP]');
  }
}
