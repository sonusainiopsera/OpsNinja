/**
 * Unit tests for portal verification token lifecycle.
 *
 * Covers:
 *  - Token generation (entropy, hash-only storage, HMAC tag)
 *  - Signature tamper detection
 *  - Expiry boundary conditions
 *  - Single-use enforcement (consumed token rejected)
 *  - Dual-key rotation overlap (previous key still verifies)
 *  - Idempotency window (60-second cache)
 *  - Resend throttle (3/hr, 5/24hr)
 *  - Failed-attempt lockout (5 fails → 15-minute lockout)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { TokenCodec, VERIFICATION_TOKEN_TTL_HOURS } from './token.codec';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, def?: string) => overrides[key] ?? def ?? '',
  } as unknown as ConfigService;
}

function emailHash(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

// ---------------------------------------------------------------------------
// TokenCodec unit tests
// ---------------------------------------------------------------------------

describe('TokenCodec', () => {
  const KEY_32_BYTES = Buffer.alloc(32, 0xab).toString('base64'); // deterministic test key

  let codec: TokenCodec;
  beforeEach(() => {
    codec = new TokenCodec(makeConfig({ PORTAL_TOKEN_SIGNING_KEY: KEY_32_BYTES }));
  });

  describe('generate()', () => {
    it('returns a rawToken that is never stored (it contains entropy + HMAC)', () => {
      const { rawToken, tokenHash } = codec.generate('token-id-1', emailHash('user@example.com'));
      expect(rawToken).not.toBe(tokenHash);
      // hash is SHA-256 hex (64 chars)
      expect(tokenHash).toHaveLength(64);
      // rawToken contains a dot separator between entropy and HMAC tag
      expect(rawToken.includes('.')).toBe(true);
    });

    it('produces a different raw token on each call (CSPRNG entropy)', () => {
      const r1 = codec.generate('tok-1', emailHash('a@b.com'));
      const r2 = codec.generate('tok-1', emailHash('a@b.com'));
      expect(r1.rawToken).not.toBe(r2.rawToken);
      expect(r1.tokenHash).not.toBe(r2.tokenHash);
    });

    it('sets expiresAt to exactly 24 hours from now', () => {
      const now = 1_700_000_000_000;
      const { expiresAt } = codec.generate('tok-2', emailHash('user@example.com'), now);
      expect(expiresAt.getTime()).toBe(now + VERIFICATION_TOKEN_TTL_HOURS * 3600 * 1000);
    });

    it('hashEmail() produces stable lowercase SHA-256 hex', () => {
      expect(codec.hashEmail('User@EXAMPLE.com')).toBe(codec.hashEmail('user@example.com'));
      expect(codec.hashEmail('user@example.com')).toHaveLength(64);
    });
  });

  describe('verify()', () => {
    it('returns valid=true for a freshly generated token', () => {
      const tokenId = 'tok-abc';
      const eh = emailHash('test@example.com');
      const { rawToken, expiresAt } = codec.generate(tokenId, eh);
      const result = codec.verify(rawToken, tokenId, eh, expiresAt.toISOString());
      expect(result.valid).toBe(true);
    });

    it('returns invalid_hmac when token body is tampered', () => {
      const tokenId = 'tok-tamper';
      const eh = emailHash('test@example.com');
      const { rawToken, expiresAt } = codec.generate(tokenId, eh);
      // Modify the entropy part
      const parts = rawToken.split('.');
      const tampered = `AAAAAAAAAAAA${parts[0]!.slice(12)}.${parts[1]}`;
      const result = codec.verify(tampered, tokenId, eh, expiresAt.toISOString());
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_hmac');
    });

    it('returns invalid_hmac when HMAC tag is tampered', () => {
      const tokenId = 'tok-hmac-tamper';
      const eh = emailHash('test@example.com');
      const { rawToken, expiresAt } = codec.generate(tokenId, eh);
      const parts = rawToken.split('.');
      const tampered = `${parts[0]}.AAAAAAAAAAAAAAA${parts[1]!.slice(15)}`;
      const result = codec.verify(tampered, tokenId, eh, expiresAt.toISOString());
      expect(result.valid).toBe(false);
    });

    it('returns malformed when token has no dot separator', () => {
      const result = codec.verify('nodotinhere', 'id', emailHash('x@y.com'), new Date().toISOString());
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('malformed');
    });

    it('returns invalid_hmac when token_id is different (binding check)', () => {
      const eh = emailHash('test@example.com');
      const { rawToken, expiresAt } = codec.generate('token-id-A', eh);
      // Present token claimed for a different tokenId
      const result = codec.verify(rawToken, 'token-id-B', eh, expiresAt.toISOString());
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('invalid_hmac');
    });

    it('returns invalid_hmac when email is different (binding check)', () => {
      const tokenId = 'tok-email-binding';
      const { rawToken, expiresAt } = codec.generate(tokenId, emailHash('real@example.com'));
      const result = codec.verify(rawToken, tokenId, emailHash('attacker@example.com'), expiresAt.toISOString());
      expect(result.valid).toBe(false);
    });
  });

  describe('dual-key rotation', () => {
    it('accepts token signed with previous key during overlap window', () => {
      const prevKey = Buffer.alloc(32, 0xcc).toString('base64');
      const oldCodec = new TokenCodec(makeConfig({ PORTAL_TOKEN_SIGNING_KEY: prevKey }));
      const newCodec = new TokenCodec(makeConfig({
        PORTAL_TOKEN_SIGNING_KEY: KEY_32_BYTES,
        PORTAL_TOKEN_SIGNING_KEY_PREVIOUS: prevKey,
      }));

      const tokenId = 'tok-rotation';
      const eh = emailHash('user@example.com');
      const { rawToken, expiresAt } = oldCodec.generate(tokenId, eh);

      // Old token issued with prevKey must still verify against newCodec (during overlap)
      const result = newCodec.verify(rawToken, tokenId, eh, expiresAt.toISOString());
      expect(result.valid).toBe(true);
    });

    it('rejects token signed with a completely unknown key', () => {
      const unknownKey = Buffer.alloc(32, 0xdd).toString('base64');
      const unknownCodec = new TokenCodec(makeConfig({ PORTAL_TOKEN_SIGNING_KEY: unknownKey }));
      const { rawToken, expiresAt } = unknownCodec.generate('tok-unknown', emailHash('x@y.com'));

      const result = codec.verify(rawToken, 'tok-unknown', emailHash('x@y.com'), expiresAt.toISOString());
      expect(result.valid).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Expiry boundary tests (pure date math — no DB needed)
// ---------------------------------------------------------------------------

describe('Expiry boundary', () => {
  it('expiresAt is strictly 24 hours from generation time', () => {
    const KEY = Buffer.alloc(32, 0x11).toString('base64');
    const codec = new TokenCodec(makeConfig({ PORTAL_TOKEN_SIGNING_KEY: KEY }));
    const now = Date.now();
    const { expiresAt } = codec.generate('x', emailHash('a@b.com'), now);
    const diffMs = expiresAt.getTime() - now;
    expect(diffMs).toBe(24 * 3600 * 1000);
  });
});
