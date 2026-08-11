/**
 * Domain normalisation pipeline for the verified domain registry (WO-028).
 *
 * Pure module — no NestJS, no DB imports. Fully unit-testable in isolation.
 *
 * Pipeline:
 *   1. Trim whitespace
 *   2. Lowercase
 *   3. Strip trailing dot (FQDN style)
 *   4. Punycode / IDNA via Node URL constructor (handles IDN → ACE)
 *   5. RFC 1035 label validation (each label max 63 chars, total max 253 chars)
 *   6. Reject single-label "domains" (TLDs)
 *
 * Security:
 *   Normalisation is applied on BOTH write (registration) and read (resolver)
 *   so a Unicode email domain always matches its stored ACE form.
 */

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface NormalizeOk {
  ok: true;
  domain: string; // ACE-encoded, lowercase, no trailing dot
}

export interface NormalizeErr {
  ok: false;
  reason: string;
}

export type NormalizeResult = NormalizeOk | NormalizeErr;

// ---------------------------------------------------------------------------
// Well-known public suffixes that must never be claimed as a domain
// (not a full PSL — just the most common multi-label suffixes that naive
//  eTLD+1 extraction would miss, plus single-label TLDs).
// ---------------------------------------------------------------------------

const PUBLIC_SUFFIX_EXACT = new Set<string>([
  // Single-label TLDs — never claimable
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'io', 'co', 'app',
  'dev', 'ai', 'uk', 'de', 'fr', 'jp', 'au', 'ca', 'cn', 'br', 'ru',
  // Common multi-label public suffixes
  'co.uk', 'co.nz', 'co.jp', 'co.za', 'co.kr', 'co.in', 'co.il',
  'com.br', 'com.au', 'com.ar', 'com.mx', 'com.co', 'com.sg', 'com.hk',
  'org.uk', 'net.uk', 'ltd.uk', 'plc.uk', 'me.uk', 'org.au', 'net.au',
  'gov.uk', 'gov.au', 'gov.ca', 'gov.in', 'gov.sg',
  'ac.uk', 'ac.nz', 'ac.jp', 'ac.in', 'ac.za',
  'ne.jp', 'or.jp', 'go.jp',
]);

// ---------------------------------------------------------------------------
// Main normalisation function
// ---------------------------------------------------------------------------

/**
 * Normalise a raw domain string into the canonical form stored in
 * organization_verified_domains.domain.
 */
export function normalizeDomain(raw: string): NormalizeResult {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, reason: 'Domain must be a non-empty string' };
  }

  // Step 1 & 2: trim + lowercase
  let domain = raw.trim().toLowerCase();

  if (domain.length === 0) {
    return { ok: false, reason: 'Domain must not be empty' };
  }

  // Step 3: strip trailing dot (FQDN)
  if (domain.endsWith('.')) {
    domain = domain.slice(0, -1);
  }

  if (domain.length === 0) {
    return { ok: false, reason: 'Domain must not be empty after stripping trailing dot' };
  }

  // Step 4: IDNA / punycode via URL constructor
  let normalized: string;
  try {
    const url = new URL(`https://${domain}`);
    normalized = url.hostname.toLowerCase();
    // Strip trailing dot that URL may add for FQDN
    if (normalized.endsWith('.')) {
      normalized = normalized.slice(0, -1);
    }
  } catch {
    return { ok: false, reason: `"${raw}" is not a valid hostname` };
  }

  // Step 5: RFC 1035 label validation
  const labels = normalized.split('.');

  if (labels.length < 2) {
    return { ok: false, reason: 'Domain must have at least two labels (e.g. example.com)' };
  }

  for (const label of labels) {
    if (label.length === 0) {
      return { ok: false, reason: 'Domain contains an empty label (consecutive dots)' };
    }
    if (label.length > 63) {
      return { ok: false, reason: `Label "${label}" exceeds 63 characters (RFC 1035)` };
    }
    // Labels may contain alphanumerics, hyphens (not at start/end), or xn-- prefix for punycode
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label) && !label.startsWith('xn--')) {
      return { ok: false, reason: `Label "${label}" contains invalid characters` };
    }
  }

  if (normalized.length > 253) {
    return { ok: false, reason: 'Domain exceeds maximum length of 253 characters' };
  }

  // Step 6: public suffix rejection
  if (isPublicSuffix(normalized)) {
    return {
      ok: false,
      reason: `"${normalized}" is a public suffix and cannot be claimed as an organization domain`,
    };
  }

  return { ok: true, domain: normalized };
}

/**
 * Extract and normalise the domain part from an email address.
 * Returns null if the email is structurally invalid.
 */
export function extractEmailDomain(email: string): NormalizeResult {
  const atIdx = email.lastIndexOf('@');
  if (atIdx < 1 || atIdx === email.length - 1) {
    return { ok: false, reason: 'Not a valid email address (missing or misplaced @)' };
  }
  return normalizeDomain(email.slice(atIdx + 1));
}

/**
 * Returns true if the domain matches a known public suffix.
 * Wildcard matching must never cross this boundary.
 */
export function isPublicSuffix(domain: string): boolean {
  return PUBLIC_SUFFIX_EXACT.has(domain);
}

/**
 * Check whether a candidate domain is a subdomain of a registered base domain.
 * e.g. isSubdomainOf('mail.acme.com', 'acme.com') === true
 *      isSubdomainOf('acme.com', 'acme.com') === false  (exact match, not sub)
 *      isSubdomainOf('evilacme.com', 'acme.com') === false
 */
export function isSubdomainOf(candidate: string, base: string): boolean {
  if (candidate === base) return false;
  return candidate.endsWith(`.${base}`);
}
