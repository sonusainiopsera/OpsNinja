/**
 * Anonymisation Validator.
 *
 * Scans generated datasets for disallowed patterns and fails if any are found.
 * Enforces:
 *   1. Allow-listed email domains — only example.com, example.org, test.invalid
 *   2. Deny-list: real phone patterns, IPv4, credit-card-like numbers
 *   3. Ensure no value originates from environment variables (no process.env reads
 *      in factory output — structural guarantee, validated by checking for
 *      common env-var value patterns like AKIA... AWS keys)
 *
 * Returns a typed result with all violations so the caller can surface them.
 */

// ---------------------------------------------------------------------------
// Allow-list
// ---------------------------------------------------------------------------

const ALLOWED_EMAIL_DOMAINS_PATTERN =
  /@(example\.com|example\.org|test\.invalid)$/i;

// ---------------------------------------------------------------------------
// Deny-list patterns
// ---------------------------------------------------------------------------

const REAL_EMAIL_DOMAIN_PATTERN =
  /@(?!example\.com|example\.org|test\.invalid)[a-z0-9.\-]+\.[a-z]{2,}/i;

const PHONE_PATTERN = /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;

const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/;

const CREDIT_CARD_PATTERN = /\b(?:\d[ -]?){13,16}\b/;

const AWS_KEY_PATTERN = /AKIA[0-9A-Z]{16}/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationViolation {
  field: string;
  value: string;
  rule: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: ValidationViolation[];
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export class AnonymisationValidator {
  validate(records: Record<string, unknown>[]): ValidationResult {
    const violations: ValidationViolation[] = [];

    for (let i = 0; i < records.length; i++) {
      this.scanObject(records[i]!, `[${i}]`, violations);
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  private scanObject(
    obj: unknown,
    path: string,
    violations: ValidationViolation[],
  ): void {
    if (typeof obj === 'string') {
      this.checkString(obj, path, violations);
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => this.scanObject(item, `${path}[${idx}]`, violations));
      return;
    }

    if (obj !== null && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        this.scanObject(value, `${path}.${key}`, violations);
      }
    }
  }

  private checkString(
    value: string,
    field: string,
    violations: ValidationViolation[],
  ): void {
    // Skip very long strings (comment bodies) for pattern matching
    const checkValue = value.length > 1000 ? value.substring(0, 500) : value;

    // Real email domain
    if (REAL_EMAIL_DOMAIN_PATTERN.test(checkValue)) {
      violations.push({ field, value: checkValue.substring(0, 80), rule: 'REAL_EMAIL_DOMAIN' });
    }

    // Phone number
    if (PHONE_PATTERN.test(checkValue) && !ALLOWED_EMAIL_DOMAINS_PATTERN.test(checkValue)) {
      violations.push({ field, value: checkValue.substring(0, 80), rule: 'PHONE_PATTERN' });
    }

    // IPv4 address (allow localhost and test ranges)
    if (IPV4_PATTERN.test(checkValue) && !/127\.0\.0\.1|0\.0\.0\.0/.test(checkValue)) {
      violations.push({ field, value: checkValue.substring(0, 80), rule: 'IPV4_ADDRESS' });
    }

    // Credit card
    if (CREDIT_CARD_PATTERN.test(checkValue)) {
      violations.push({ field, value: '***', rule: 'CREDIT_CARD_LIKE' });
    }

    // AWS access key
    if (AWS_KEY_PATTERN.test(checkValue)) {
      violations.push({ field, value: '***', rule: 'AWS_ACCESS_KEY' });
    }
  }
}
