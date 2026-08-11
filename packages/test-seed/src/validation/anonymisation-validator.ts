/**
 * AnonymisationValidator – scans a generated dataset for disallowed patterns.
 *
 * Rules:
 *  - Email addresses must use only reserved domains (example.com, example.org,
 *    example.net, example.invalid). Real-world TLDs in email strings are blocked.
 *  - No phone-number-like patterns (7+ consecutive digits with optional dashes).
 *  - No IPv4 addresses (production infrastructure IPs are PII in this context).
 *  - No credit-card-like patterns (16-digit sequences).
 *  - No value may originate from process.env (structurally prevented — values
 *    are never interpolated from env in factories).
 */

export interface ValidationError {
  path: string;
  value: string;
  rule: string;
}

// Regex patterns for disallowed content
const EMAIL_WITH_REAL_DOMAIN = /[a-z0-9._%+\-]+@(?!example\.com|example\.org|example\.net|example\.invalid)[a-z0-9.\-]+\.[a-z]{2,}/i;
const PHONE_LIKE = /\b\d[\d\s\-().]{6,}\d\b/;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|1?\d\d?)\b/;
const CREDIT_CARD_LIKE = /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/;

export class AnonymisationValidator {
  private readonly errors: ValidationError[] = [];

  /** Validate a flat or nested object; path is the dot-notation key prefix. */
  validate(obj: unknown, path = ''): void {
    if (obj === null || obj === undefined) return;
    if (typeof obj === 'string') {
      this.checkString(obj, path);
      return;
    }
    if (typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        this.validate(value, path ? `${path}.${key}` : key);
      }
      return;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        this.validate(obj[i], `${path}[${i}]`);
      }
    }
  }

  /** Validate an array of records (typically a factory output). */
  validateMany(records: unknown[], path = 'records'): void {
    for (let i = 0; i < records.length; i++) {
      this.validate(records[i], `${path}[${i}]`);
    }
  }

  /** Returns all errors found since construction. */
  getErrors(): ReadonlyArray<ValidationError> {
    return this.errors;
  }

  /** Returns true if no violations were found. */
  isValid(): boolean {
    return this.errors.length === 0;
  }

  /** Throws with a summary if any violations were found. */
  assertValid(): void {
    if (!this.isValid()) {
      const summary = this.errors
        .slice(0, 5)
        .map((e) => `  [${e.rule}] at ${e.path}: "${e.value.slice(0, 60)}"`)
        .join('\n');
      const extra = this.errors.length > 5 ? `\n  ... and ${this.errors.length - 5} more` : '';
      throw new Error(
        `Anonymisation validation failed: ${this.errors.length} violation(s)\n${summary}${extra}`,
      );
    }
  }

  private checkString(value: string, path: string): void {
    if (EMAIL_WITH_REAL_DOMAIN.test(value)) {
      this.errors.push({ path, value, rule: 'REAL_EMAIL_DOMAIN' });
    }
    if (PHONE_LIKE.test(value) && !this.looksSafe(value)) {
      this.errors.push({ path, value, rule: 'PHONE_LIKE_PATTERN' });
    }
    if (IPV4.test(value)) {
      this.errors.push({ path, value, rule: 'IPV4_ADDRESS' });
    }
    if (CREDIT_CARD_LIKE.test(value)) {
      this.errors.push({ path, value, rule: 'CREDIT_CARD_LIKE' });
    }
  }

  /**
   * Conservative allow-list: long digit sequences in UUIDs and similar
   * technical strings are not phone numbers.
   */
  private looksSafe(value: string): boolean {
    // UUIDs, timestamps, numeric IDs — not phone-like despite containing digits.
    return /^[0-9a-f\-]{32,}$/i.test(value) || /^\d{4}-\d{2}-\d{2}/.test(value);
  }
}
