/**
 * TokenCodec — pure cryptographic operations for portal verification tokens.
 *
 * Token format (raw string, never persisted):
 *   <base64url(32 bytes entropy)>.<base64url(HMAC-SHA256 tag)>
 *
 * HMAC input (signed payload):
 *   "<tokenId>.<emailHash>.<expiresAtIso>"
 *
 * Storage:
 *   Only SHA-256 hex of the full raw token is persisted (token_hash column).
 *   The raw token travels in the email link only and is NEVER written to logs,
 *   metrics, audit records, or the database.
 *
 * Key rotation:
 *   PORTAL_TOKEN_SIGNING_KEY   — current key (base64-encoded 256-bit)
 *   PORTAL_TOKEN_SIGNING_KEY_PREVIOUS — previous key for the rotation overlap window
 *   Both keys are tried during verification; only the current key is used for issuance.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';

export const VERIFICATION_TOKEN_TTL_HOURS = 24;

export interface GeneratedToken {
  /** The raw token string — deliver in email link, NEVER persist or log. */
  rawToken: string;
  /** SHA-256 hex of rawToken — the only value stored in token_hash. */
  tokenHash: string;
  /** Expiry time, TTL_HOURS from now. */
  expiresAt: Date;
  /** Opaque token_id for the DB row. */
  tokenId: string;
}

export interface VerifyResult {
  valid: boolean;
  reason?: 'malformed' | 'invalid_hmac' | 'expired' | 'no_valid_key';
}

@Injectable()
export class TokenCodec {
  private readonly currentKey: Buffer;
  private readonly previousKey: Buffer | null;

  constructor(private readonly config: ConfigService) {
    const currentRaw = config.get<string>('PORTAL_TOKEN_SIGNING_KEY', '');
    const prevRaw = config.get<string>('PORTAL_TOKEN_SIGNING_KEY_PREVIOUS', '');

    // Fallback to a zero key in test/dev — operators must set this in production
    this.currentKey = currentRaw
      ? Buffer.from(currentRaw, 'base64')
      : Buffer.alloc(32, 0x00);
    this.previousKey = prevRaw ? Buffer.from(prevRaw, 'base64') : null;
  }

  /**
   * Generate a new verification token.
   *
   * @param tokenId   The UUID that will be stored in portal_verification_tokens.token_id
   * @param emailHash SHA-256 hex of the lowercase email address
   * @param now       Injectable clock for test determinism (defaults to Date.now())
   */
  generate(tokenId: string, emailHash: string, now?: number): GeneratedToken {
    const nowMs = now ?? Date.now();
    const expiresAt = new Date(nowMs + VERIFICATION_TOKEN_TTL_HOURS * 3600 * 1000);

    const entropy = randomBytes(32).toString('base64url');
    const tag = this.computeHmac(this.currentKey, tokenId, emailHash, expiresAt.toISOString());
    const rawToken = `${entropy}.${tag}`;
    const tokenHash = this.hash(rawToken);

    return { rawToken, tokenHash, expiresAt, tokenId };
  }

  /**
   * Verify the HMAC tag embedded in a raw token.
   *
   * Tries the current key first, then the previous key (for rotation overlap).
   * Does NOT check expiry — that is the caller's responsibility (evaluated
   * against database now() to avoid clock-skew issues across pods).
   */
  verify(
    rawToken: string,
    tokenId: string,
    emailHash: string,
    expiresAtIso: string,
  ): VerifyResult {
    const parts = rawToken.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { valid: false, reason: 'malformed' };
    }

    const expectedCurrent = this.computeHmac(this.currentKey, tokenId, emailHash, expiresAtIso);

    // Timing-safe comparison against current key
    if (this.safeCompare(parts[1], expectedCurrent)) {
      return { valid: true };
    }

    // Try previous key during rotation overlap window
    if (this.previousKey) {
      const expectedPrev = this.computeHmac(this.previousKey, tokenId, emailHash, expiresAtIso);
      if (this.safeCompare(parts[1], expectedPrev)) {
        return { valid: true };
      }
    }

    return { valid: false, reason: 'invalid_hmac' };
  }

  /** SHA-256 hex of the raw token — the only value stored server-side. */
  hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /** SHA-256 hex of a lowercase-trimmed email address. */
  hashEmail(email: string): string {
    return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
  }

  private computeHmac(
    key: Buffer,
    tokenId: string,
    emailHash: string,
    expiresAtIso: string,
  ): string {
    const payload = `${tokenId}.${emailHash}.${expiresAtIso}`;
    return createHmac('sha256', key).update(payload).digest('base64url');
  }

  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      return false;
    }
  }
}
