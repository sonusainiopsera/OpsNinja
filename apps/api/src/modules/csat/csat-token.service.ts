/**
 * CsatTokenService – generates and verifies single-use CSAT capability tokens.
 *
 * Token flow:
 *   1. Generate: crypto.randomBytes(32) → base64url transport token
 *   2. Store:    SHA-256 hex of the transport token → token_hash in DB
 *   3. Lookup:   hash(incoming) → find row → timingSafeEqual(hash(incoming), row.tokenHash)
 *   4. Expiry:   respondedAt IS NULL AND expiresAt > now
 *
 * The raw token NEVER appears in logs or the database.  Only the hash is persisted.
 */

import { Injectable } from '@nestjs/common';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/** Injectable clock for testability. */
export type Clock = () => Date;

@Injectable()
export class CsatTokenService {
  constructor(private readonly clock: Clock = () => new Date()) {}

  /** Returns 32 bytes of CSPRNG encoded as base64url (43-char string). */
  generateRawToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /** Returns the lowercase SHA-256 hex hash of a raw base64url token. */
  hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }

  /**
   * Constant-time comparison of the incoming raw token hash against a stored hash.
   * Both arguments must be hex strings of equal length (64 chars for SHA-256).
   */
  verifyHash(incoming: string, stored: string): boolean {
    if (incoming.length !== stored.length) return false;
    const a = Buffer.from(incoming, 'hex');
    const b = Buffer.from(stored, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** Returns true if the survey has passed its expiry boundary. */
  isExpired(expiresAt: Date): boolean {
    return this.clock() >= expiresAt;
  }

  /** Computes expires_at from a creation timestamp and per-tenant expiry days. */
  computeExpiresAt(from: Date, expiryDays: number): Date {
    const d = new Date(from.getTime());
    d.setDate(d.getDate() + expiryDays);
    return d;
  }
}
