import { describe, it, expect, beforeEach } from 'vitest';
import { CsatTokenService } from './csat-token.service';

describe('CsatTokenService', () => {
  let service: CsatTokenService;
  let fixedNow: number;

  beforeEach(() => {
    fixedNow = new Date('2026-01-15T12:00:00Z').getTime();
    service = new CsatTokenService(() => fixedNow);
  });

  describe('generateRawToken', () => {
    it('generates a 43-char base64url token', () => {
      const token = service.generateRawToken();
      expect(token).toHaveLength(43);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('generates unique tokens on each call', () => {
      const tokens = new Set(Array.from({ length: 100 }, () => service.generateRawToken()));
      expect(tokens.size).toBe(100);
    });

    it('produces 32 bytes of entropy (base64url of 32 bytes = 43 chars, no padding)', () => {
      const token = service.generateRawToken();
      const decoded = Buffer.from(token, 'base64url');
      expect(decoded.byteLength).toBe(32);
    });
  });

  describe('hashToken', () => {
    it('returns a 64-char lowercase hex string', () => {
      const hash = service.hashToken('test-token');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for the same input', () => {
      const t = 'predictable-input';
      expect(service.hashToken(t)).toBe(service.hashToken(t));
    });

    it('produces different hashes for different inputs', () => {
      expect(service.hashToken('a')).not.toBe(service.hashToken('b'));
    });
  });

  describe('verifyHash', () => {
    it('returns true for matching hashes', () => {
      const rawToken = service.generateRawToken();
      const hash = service.hashToken(rawToken);
      expect(service.verifyHash(hash, service.hashToken(rawToken))).toBe(true);
    });

    it('returns false for mismatched hashes (constant-time)', () => {
      const hash1 = service.hashToken('token1');
      const hash2 = service.hashToken('token2');
      expect(service.verifyHash(hash1, hash2)).toBe(false);
    });

    it('returns false if either hash has wrong length (not 64 chars)', () => {
      const hash = service.hashToken('valid');
      expect(service.verifyHash(hash.slice(0, 32), hash)).toBe(false);
      expect(service.verifyHash(hash, hash.slice(0, 32))).toBe(false);
    });

    it('returns false for empty strings', () => {
      expect(service.verifyHash('', '')).toBe(false);
    });
  });

  describe('isExpired', () => {
    it('returns true when now >= expiresAt (inclusive boundary)', () => {
      // Exactly at boundary
      expect(service.isExpired(new Date(fixedNow))).toBe(true);
      // 1ms after
      expect(service.isExpired(new Date(fixedNow - 1))).toBe(true);
    });

    it('returns false when expiresAt is in the future', () => {
      expect(service.isExpired(new Date(fixedNow + 1))).toBe(false);
      expect(service.isExpired(new Date(fixedNow + 86400000))).toBe(false);
    });
  });

  describe('computeExpiresAt', () => {
    it('defaults to 14 days', () => {
      const expires = service.computeExpiresAt();
      const expected = fixedNow + 14 * 24 * 60 * 60 * 1000;
      expect(expires.getTime()).toBe(expected);
    });

    it('respects custom expiryDays', () => {
      const expires = service.computeExpiresAt(7);
      expect(expires.getTime()).toBe(fixedNow + 7 * 24 * 60 * 60 * 1000);
    });
  });
});
