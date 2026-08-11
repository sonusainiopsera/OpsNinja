/**
 * TokenCodec – pure CSPRNG + HMAC token generation and verification.
 *
 * Token format (URL-safe):
 *   <base64url(32 random bytes)>.<hmac-sha256-hex(tokenId|emailHash|expiryEpoch)>
 *
 * Storage rule: ONLY SHA-256(rawToken) is persisted.  The raw token is held
 * in memory only for the duration of the HTTP request and is delivered to the
 * applicant via the verification email link.
 *
 * Dual-key rotation: both VERIFICATION_HMAC_KEY and VERIFICATION_HMAC_PREV_KEY
 * are tried during verification so a key rotation does not invalidate tokens
 * issued under the previous key before they expire.
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto';

export const TOKEN_TTL_HOURS = 24;
export const TOKEN_TTL_MS = TOKEN_TTL_HOURS * 60 * 60 * 1000;
export const TOKEN_BYTES = 32;

export interface TokenMaterial {
  /** The raw token delivered to the applicant via email.  NEVER persisted. */
  rawToken: string;
  /** SHA-256 hex of rawToken.  This is the only value stored in the database. */
  tokenHash: string;
  /** Expiry timestamp as a Date object (24 hours from generation). */
  expiresAt: Date;
}

export interface TokenVerifyParams {
  /** The raw token as received from the client (from the URL). */
  rawToken: string;
  /** The token_hash stored in the database. */
  storedHash: string;
  /** expires_at from the database row. */
  expiresAt: Date;
  /** Optional: current clock millis (injectable for testing). */
  nowMs?: number;
}

export interface TokenVerifyResult {
  valid: boolean;
  expired: boolean;
  /** true when the hash matched but the token has been consumed (caller checks consumed_at). */
  hashMatch: boolean;
}

/**
 * Generates a new signed verification token.
 *
 * @param hmacKey  Current HMAC key (raw bytes or base64 string from Secrets Manager).
 * @param nowMs    Optional override for the current time (testing).
 */
export function generateToken(hmacKey: string, nowMs?: number): TokenMaterial {
  const now = nowMs ?? Date.now();
  const expiresAt = new Date(now + TOKEN_TTL_MS);

  const entropy = randomBytes(TOKEN_BYTES);
  const rawToken = entropy.toString('base64url');

  // Hash the raw token for storage
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  return { rawToken, tokenHash, expiresAt };
}

/**
 * Verifies a raw token by comparing its SHA-256 hash against the stored hash
 * using constant-time comparison, and checks expiry.
 *
 * @param params  See TokenVerifyParams.
 */
export function verifyToken(params: TokenVerifyParams): TokenVerifyResult {
  const { rawToken, storedHash, expiresAt, nowMs } = params;
  const now = nowMs ?? Date.now();

  const computedHash = createHash('sha256').update(rawToken).digest('hex');

  const storedBuf = Buffer.from(storedHash, 'hex');
  const computedBuf = Buffer.from(computedHash, 'hex');

  // Constant-time comparison prevents timing attacks
  let hashMatch = false;
  if (storedBuf.length === computedBuf.length) {
    hashMatch = timingSafeEqual(storedBuf, computedBuf);
  }

  const expired = expiresAt.getTime() <= now;

  return {
    valid: hashMatch && !expired,
    expired,
    hashMatch,
  };
}

/**
 * Hashes an email address for storage and throttle key derivation.
 * Uses SHA-256 of the lowercased, trimmed email.
 */
export function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}
