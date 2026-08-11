/**
 * CsatTokenService
 *
 * Generates, hashes and verifies single-use CSAT survey tokens.
 *
 * Token design:
 *  - 32 bytes of CSPRNG → base64url (43 chars, URL-safe, no padding)
 *  - Stored only as SHA-256 hex (64 chars) — raw token NEVER persisted
 *  - Constant-time comparison via timingSafeEqual prevents timing oracle
 *  - Expiry evaluated against configurable clock for test injection
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';

@Injectable()
export class CsatTokenService {
  /** Seeded for tests via the constructor; defaults to Date.now in production. */
  private readonly clock: () => number;

  constructor(@Optional() @Inject('CSAT_CLOCK') clock?: () => number) {
    this.clock = clock ?? (() => Date.now());
  }

  /**
   * Generate a raw token suitable for inclusion in an email URL.
   * Returns 43-char base64url string (32 raw bytes, no padding).
   */
  generateRawToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Hash a raw token (or any string) with SHA-256 and return lowercase hex.
   * This is what is stored in the database.
   */
  hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Constant-time comparison of two token hashes.
   * Both inputs must be 64-char hex strings (SHA-256 output).
   * Returns false if lengths differ (no timing leak).
   */
  verifyHash(storedHash: string, computedHash: string): boolean {
    if (storedHash.length !== 64 || computedHash.length !== 64) {
      return false;
    }
    try {
      return timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(computedHash, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Returns true if the survey is expired at the current clock time.
   * Boundary: expired if now >= expiresAt (inclusive — expired AT the boundary second).
   */
  isExpired(expiresAt: Date): boolean {
    return this.clock() >= expiresAt.getTime();
  }

  /**
   * Compute the expiry timestamp for a new survey.
   * expiryDays defaults to 14 (tenant-configurable via organizations.csat_expiry_days).
   */
  computeExpiresAt(expiryDays = 14): Date {
    const ms = this.clock() + expiryDays * 24 * 60 * 60 * 1000;
    return new Date(ms);
  }
}
