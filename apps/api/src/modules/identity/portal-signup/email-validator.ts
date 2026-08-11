/**
 * Email validation and normalisation for portal signup.
 *
 * Responsibilities:
 *   1. Syntactic validation (RFC 5322-compatible via Zod email rule + length caps)
 *   2. Normalisation: lowercase, trim whitespace, strip plus-addressing, punycode IDN
 *   3. Deny-list check: free-mail and disposable providers
 *
 * This module is intentionally dependency-free (no NestJS, no Drizzle) so it
 * can be used in tests without any DI setup.
 *
 * Security note:
 *   This is allow-list shaped: an email must pass ALL validation steps.
 *   An unknown domain is NOT a rejection reason — only known-bad domains are.
 *   Tenant resolution happens separately in DomainResolverService.
 */

import { z } from 'zod';
import { isDeniedDomain } from './free-mail-domains.data';

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const EMAIL_VALIDATION_CODES = {
  INVALID_FORMAT: 'SIGNUP_EMAIL_INVALID',
  DOMAIN_NOT_ALLOWED: 'SIGNUP_DOMAIN_NOT_ALLOWED',
} as const;

export type EmailValidationCode = (typeof EMAIL_VALIDATION_CODES)[keyof typeof EMAIL_VALIDATION_CODES];

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface EmailValidOk {
  valid: true;
  normalised: string;
  domain: string;
}

export interface EmailValidFail {
  valid: false;
  code: EmailValidationCode;
  message: string;
}

export type EmailValidationResult = EmailValidOk | EmailValidFail;

// ---------------------------------------------------------------------------
// Zod schema for syntactic check
// ---------------------------------------------------------------------------

const EmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .email()
  .transform((v) => v.toLowerCase());

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------

/**
 * Validate and normalise a portal signup email address.
 *
 * Steps:
 *   1. Zod email validation + lowercase transform
 *   2. Strip plus-address (e.g. alice+work@example.com → alice@example.com)
 *   3. Punycode-normalise the domain (IDN homograph defence)
 *   4. Deny-list check (free-mail + disposable)
 */
export function validateSignupEmail(raw: string): EmailValidationResult {
  // Step 1: syntactic validation
  const parsed = EmailSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      code: EMAIL_VALIDATION_CODES.INVALID_FORMAT,
      message: 'The email address is not a valid format.',
    };
  }

  const lowercased = parsed.data;
  const atIdx = lowercased.lastIndexOf('@');
  if (atIdx === -1) {
    return {
      valid: false,
      code: EMAIL_VALIDATION_CODES.INVALID_FORMAT,
      message: 'The email address is missing the @ character.',
    };
  }

  // Step 2: strip plus-addressing from local part
  const localPart = lowercased.slice(0, atIdx).split('+')[0]!;
  const domainPart = lowercased.slice(atIdx + 1);

  // Step 3: punycode-normalise domain (Node built-in URL constructor handles IDN → ASCII)
  let normalisedDomain: string;
  try {
    const url = new URL(`https://${domainPart}`);
    // url.hostname returns the ACE form (xn--...) for IDN domains
    normalisedDomain = url.hostname.toLowerCase();
  } catch {
    return {
      valid: false,
      code: EMAIL_VALIDATION_CODES.INVALID_FORMAT,
      message: 'The email domain is not a valid hostname.',
    };
  }

  const normalisedEmail = `${localPart}@${normalisedDomain}`;

  // Step 4: deny-list check
  if (isDeniedDomain(normalisedDomain)) {
    return {
      valid: false,
      code: EMAIL_VALIDATION_CODES.DOMAIN_NOT_ALLOWED,
      message:
        'The email domain is not accepted. Please use a business email address.',
    };
  }

  return {
    valid: true,
    normalised: normalisedEmail,
    domain: normalisedDomain,
  };
}
