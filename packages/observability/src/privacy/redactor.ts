/**
 * Enhanced PII redactor — pure, bounded functions.
 *
 * Two-pass approach:
 *   Pass 1: key-name allow-list (REDACTED_KEYS) → apply strategy (drop/mask/hash).
 *   Pass 2: pattern detectors on unclassified string values (email, phone, IP,
 *           JWT, AWS key, high-entropy) — defense-in-depth second line only.
 *
 * Guards:
 *   - Max traversal depth: 8
 *   - Max keys per object: 256
 *   - Max string length scanned for patterns: 8 KB (8192 chars)
 *
 * The redactor NEVER throws into the caller: internal errors produce a
 * REDACTION_ERROR marker so the log line is not lost.
 */

import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_DEPTH = 8;
export const MAX_KEYS = 256;
export const MAX_STRING_LEN = 8192; // 8 KB

const REDACTION_ERROR_MARKER = '[REDACTION_ERROR]';
const REDACTED_PLACEHOLDER = '[REDACTED]';
const TRUNCATED_MARKER = '[TRUNCATED]';
const CIRCULAR_MARKER = '[CIRCULAR]';
const DEPTH_EXCEEDED_MARKER = '[DEPTH_EXCEEDED]';

// ---------------------------------------------------------------------------
// Key-name strategy map (pass 1)
//
// 'drop'  → remove key entirely from output
// 'mask'  → replace with REDACTED_PLACEHOLDER
// 'hash'  → replace with 16-hex-char salted SHA-256
//
// These keys are aggregated from the classification registry at module load
// time so hot-path lookups are O(1) Map lookups.
// ---------------------------------------------------------------------------

export const DROP_KEYS = new Set([
  // Free-text bodies: credential leak risk — drop wholesale
  'body',
  'rendered_body',
  'htmlBody',
  'textBody',
  'bodyTemplate',
  'body_template',
  'text_template',
  'textTemplate',
  'aiSummary',
  'ai_summary',
  // Comment is confidential free-text
  'comment',
  'csatComment',
  'csat_comment',
  // Notification payload may embed PII
  'payload',
  // Webhook restricted fields
  'secretCiphertext',
  'secret_ciphertext',
  'previousSecretCiphertext',
  'previous_secret_ciphertext',
  'canonicalPayload',
  'canonical_payload',
  'responseSnippet',
  'response_snippet',
  // Jira / OAuth restricted
  'secretRef',
  'secret_ref',
  // S3 keys, token hashes
  's3Key',
  's3_key',
  'tokenHash',
  'token_hash',
  // CSAT token hashes
  // Portal verification token hash
]);

export const MASK_KEYS = new Set([
  // PII email fields
  'email',
  'recipientEmail',
  'recipient_email',
  'to',
  // PII name fields
  'fullName',
  'full_name',
  'applicantName',
  'applicant_name',
  'name',  // only when encountered in identity context
  // PII phone fields
  'phone',
  'phoneNumber',
  'phone_number',
  // IP addresses
  'ipAddress',
  'ip_address',
  // Filenames may contain PII
  'filename',
  // Webhook URL is internal but not redacted by default — only mask if signing
]);

export const HASH_KEYS = new Set([
  // Correlation hashes — safe for linking without disclosure
  'emailHash',
  'email_hash',
  'ipHash',
  'ip_hash',
]);

// Restricted token/key fields masked entirely (separate from DROP so the key
// remains visible in the log with a placeholder rather than disappearing)
export const REDACT_KEYS = new Set([
  // OAuth tokens
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
  // Signing primitives
  'secret',
  'plaintext',
  'signingKey',
  'signing_key',
  // Signature header values
  'signatureHeader',
  'signature_header',
  'x-opsninja-signature',
  // Token hash preview (partial, but still redact)
  'tokenHashPreview',
  'token_hash_preview',
]);

// ---------------------------------------------------------------------------
// Pattern detectors (pass 2 — applied to string values not caught by pass 1)
// ---------------------------------------------------------------------------

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_E164_RE = /\+[1-9]\d{6,14}/g;
const PHONE_NANP_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
const IPV6_RE = /(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}|::(?:[0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const AWS_KEY_RE = /(?:AKIA|ASIA|AROA|AIDA|AIPA|ANPA|ANVA|APKA)[0-9A-Z]{16}/g;

/** Shannon entropy in bits per character. */
function shannonEntropy(s: string): number {
  const freq: Record<string, number> = {};
  for (const ch of s) freq[ch] = (freq[ch] ?? 0) + 1;
  const len = s.length;
  let h = 0;
  for (const c of Object.values(freq)) {
    const p = c / len;
    h -= p * Math.log2(p);
  }
  return h;
}

const HIGH_ENTROPY_THRESHOLD = 4.5;
const HIGH_ENTROPY_MIN_LEN = 20;

function looksLikeHighEntropySecret(s: string): boolean {
  // Only flag strings that look like base64/hex/token data, not prose
  if (s.length < HIGH_ENTROPY_MIN_LEN) return false;
  if (/\s/.test(s)) return false; // words with spaces are not secrets
  return shannonEntropy(s) >= HIGH_ENTROPY_THRESHOLD;
}

/** Redact known patterns from a string (pass-2 pattern layer). */
export function redactString(text: string): string {
  if (text.length > MAX_STRING_LEN) {
    // Truncate before scanning to honour the CPU/memory guard
    text = text.slice(0, MAX_STRING_LEN) + TRUNCATED_MARKER;
  }
  return text
    .replace(JWT_RE, '[REDACTED_JWT]')
    .replace(AWS_KEY_RE, '[REDACTED_AWS_KEY]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(PHONE_E164_RE, '[REDACTED_PHONE]')
    .replace(PHONE_NANP_RE, '[REDACTED_PHONE]')
    .replace(IPV4_RE, '[REDACTED_IP]')
    .replace(IPV6_RE, '[REDACTED_IP]');
}

// ---------------------------------------------------------------------------
// Masking helpers
// ---------------------------------------------------------------------------

/** Mask an email: j***@example.com → j***@e***.com */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return REDACTED_PLACEHOLDER;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const domainBody = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  const maskedLocal = local[0] + '***';
  const maskedDomain = (domainBody[0] ?? '') + '***' + tld;
  return `${maskedLocal}@${maskedDomain}`;
}

/** Mask an IP address: 192.168.1.42 → 192.168.***.*** */
export function maskIp(ip: string): string {
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.***.***`;
  }
  // IPv6 — redact last 4 groups
  return ip.replace(/:[0-9a-fA-F:]+$/, ':****');
}

/** Produce a 16-char salted hash (not reversible, suitable for correlation). */
export function hashValue(value: string): string {
  return createHash('sha256')
    .update('opsninja-log-salt:')
    .update(value)
    .digest('hex')
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Redact options
// ---------------------------------------------------------------------------

export interface RedactOptions {
  /** Maximum traversal depth (default: MAX_DEPTH). */
  maxDepth?: number;
  /** Maximum keys per object (default: MAX_KEYS). */
  maxKeys?: number;
}

// ---------------------------------------------------------------------------
// Core redactObject
// ---------------------------------------------------------------------------

export function redactObject(value: unknown, opts?: RedactOptions): unknown {
  try {
    const seen = new WeakSet<object>();
    return _redact(value, 0, opts?.maxDepth ?? MAX_DEPTH, opts?.maxKeys ?? MAX_KEYS, seen);
  } catch {
    return REDACTION_ERROR_MARKER;
  }
}

function _redact(
  value: unknown,
  depth: number,
  maxDepth: number,
  maxKeys: number,
  seen: WeakSet<object>,
): unknown {
  // Primitives that are not objects/arrays pass through (except strings)
  if (value === null || value === undefined) return value;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return value.toString() + 'n';

  if (typeof value === 'string') {
    // Only run expensive pattern scan if string is from an unclassified field;
    // classified fields are handled by the key-based pass before we reach here.
    // When called directly on a string, always scan.
    if (looksLikeHighEntropySecret(value)) return REDACTED_PLACEHOLDER;
    return redactString(value);
  }

  // Non-plain types
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Buffer) return `[Buffer ${value.length}b]`;
  if (value instanceof Error) {
    return {
      error: value.constructor.name,
      message: redactString(value.message),
      // Do not include stack — may contain file paths / env secrets
    };
  }

  // Object/Array — apply depth guard
  if (depth >= maxDepth) return DEPTH_EXCEEDED_MARKER;

  if (typeof value === 'object') {
    // Circular reference guard
    if (seen.has(value as object)) return CIRCULAR_MARKER;
    seen.add(value as object);

    if (Array.isArray(value)) {
      const result = value.map((item) => _redact(item, depth + 1, maxDepth, maxKeys, seen));
      seen.delete(value as object);
      return result;
    }

    // Plain object
    const entries = Object.entries(value as Record<string, unknown>);
    const truncated = entries.length > maxKeys;
    const limited = truncated ? entries.slice(0, maxKeys) : entries;

    const result: Record<string, unknown> = {};
    for (const [key, val] of limited) {
      const lowerKey = key.toLowerCase();

      if (DROP_KEYS.has(key) || DROP_KEYS.has(lowerKey)) {
        // Drop the key entirely — do not include in output
        continue;
      }

      if (REDACT_KEYS.has(key) || REDACT_KEYS.has(lowerKey)) {
        result[key] = REDACTED_PLACEHOLDER;
        continue;
      }

      if (MASK_KEYS.has(key) || MASK_KEYS.has(lowerKey)) {
        if (typeof val === 'string' && EMAIL_RE.test(val)) {
          EMAIL_RE.lastIndex = 0;
          result[key] = maskEmail(val);
        } else if (typeof val === 'string' && IPV4_RE.test(val)) {
          IPV4_RE.lastIndex = 0;
          result[key] = maskIp(val);
        } else {
          result[key] = typeof val === 'string' ? REDACTED_PLACEHOLDER : REDACTED_PLACEHOLDER;
        }
        continue;
      }

      if (HASH_KEYS.has(key) || HASH_KEYS.has(lowerKey)) {
        result[key] = typeof val === 'string' ? `[HASH:${hashValue(val)}]` : REDACTED_PLACEHOLDER;
        continue;
      }

      // No key-based rule — recurse with pattern pass on strings
      result[key] = _redact(val, depth + 1, maxDepth, maxKeys, seen);
    }

    if (truncated) {
      result['__truncated__'] = `${entries.length - maxKeys} keys omitted`;
    }

    seen.delete(value as object);
    return result;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Legacy compat re-exports (used by existing log-redactor.ts consumers)
// ---------------------------------------------------------------------------

export function redactEmailsInString(value: string): string {
  return value.replace(EMAIL_RE, '[REDACTED_EMAIL]');
}

export function redactLogObject(obj: unknown): unknown {
  return redactObject(obj);
}

export function toRedactedLogString(record: Record<string, unknown>): string {
  return JSON.stringify(redactObject(record));
}
