import { generateToken, verifyToken, hashEmail, TOKEN_TTL_MS, TOKEN_BYTES } from '../token.codec';
import { createHash } from 'crypto';

const TEST_HMAC_KEY = 'test-hmac-key-for-unit-tests';
const FIXED_NOW = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z

describe('token.codec', () => {
  describe('generateToken', () => {
    it('produces a non-empty raw token', () => {
      const { rawToken } = generateToken(TEST_HMAC_KEY, FIXED_NOW);
      expect(rawToken).toBeTruthy();
      expect(typeof rawToken).toBe('string');
    });

    it('raw token is base64url encoded (no +, /, = chars)', () => {
      const { rawToken } = generateToken(TEST_HMAC_KEY, FIXED_NOW);
      expect(rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('decoded entropy is at least TOKEN_BYTES long', () => {
      const { rawToken } = generateToken(TEST_HMAC_KEY, FIXED_NOW);
      const decoded = Buffer.from(rawToken, 'base64url');
      expect(decoded.length).toBeGreaterThanOrEqual(TOKEN_BYTES);
    });

    it('tokenHash is SHA-256 hex of rawToken', () => {
      const { rawToken, tokenHash } = generateToken(TEST_HMAC_KEY, FIXED_NOW);
      const expected = createHash('sha256').update(rawToken).digest('hex');
      expect(tokenHash).toBe(expected);
    });

    it('expiresAt is exactly TOKEN_TTL_MS in the future', () => {
      const { expiresAt } = generateToken(TEST_HMAC_KEY, FIXED_NOW);
      expect(expiresAt.getTime()).toBe(FIXED_NOW + TOKEN_TTL_MS);
    });

    it('generates unique tokens on each call', () => {
      const a = generateToken(TEST_HMAC_KEY, FIXED_NOW);
      const b = generateToken(TEST_HMAC_KEY, FIXED_NOW);
      expect(a.rawToken).not.toBe(b.rawToken);
      expect(a.tokenHash).not.toBe(b.tokenHash);
    });
  });

  describe('verifyToken', () => {
    it('returns valid=true for a fresh token', () => {
      const { rawToken, tokenHash, expiresAt } = generateToken(TEST_HMAC_KEY, FIXED_NOW);
      const result = verifyToken({ rawToken, storedHash: tokenHash, expiresAt, nowMs: FIXED_NOW });
      expect(result.valid).toBe(true);
      expect(result.hashMatch).toBe(true);
      expect(result.expired).toBe(false);
    });

    it('returns expired=true at exact expiry boundary', () => {
      const { rawToken, tokenHash, expiresAt } = generateToken(TEST_HMAC_KEY, FIXED_NOW);
      // Exactly at expiry: expiresAt.getTime() <= nowMs → expired
      const result = verifyToken({
        rawToken,
        storedHash: tokenHash,
        expiresAt,
        nowMs: expiresAt.getTime(),
      });
      expect(result.expired).toBe(true);
      expect(result.valid).toBe(false);
    });

    it('returns expired=false one millisecond before expiry', () => {
      const { rawToken, tokenHash, expiresAt } = generateToken(TEST_HMAC_KEY, FIXED_NOW);
      const result = verifyToken({
        rawToken,
        storedHash: tokenHash,
        expiresAt,
        nowMs: expiresAt.getTime() - 1,
      });
      expect(result.expired).toBe(false);
      expect(result.valid).toBe(true);
    });

    it('returns hashMatch=false for tampered token', () => {
      const { tokenHash, expiresAt } = generateToken(TEST_HMAC_KEY, FIXED_NOW);
      const result = verifyToken({
        rawToken: 'tampered-token-value',
        storedHash: tokenHash,
        expiresAt,
        nowMs: FIXED_NOW,
      });
      expect(result.hashMatch).toBe(false);
      expect(result.valid).toBe(false);
    });

    it('returns hashMatch=false for wrong stored hash', () => {
      const { rawToken, expiresAt } = generateToken(TEST_HMAC_KEY, FIXED_NOW);
      const wrongHash = createHash('sha256').update('wrong').digest('hex');
      const result = verifyToken({
        rawToken,
        storedHash: wrongHash,
        expiresAt,
        nowMs: FIXED_NOW,
      });
      expect(result.hashMatch).toBe(false);
      expect(result.valid).toBe(false);
    });

    it('is invalid when both expired and tampered', () => {
      const { tokenHash, expiresAt } = generateToken(TEST_HMAC_KEY, FIXED_NOW);
      const result = verifyToken({
        rawToken: 'tampered',
        storedHash: tokenHash,
        expiresAt,
        nowMs: expiresAt.getTime() + 1,
      });
      expect(result.valid).toBe(false);
      expect(result.expired).toBe(true);
      expect(result.hashMatch).toBe(false);
    });
  });

  describe('hashEmail', () => {
    it('is deterministic for the same input', () => {
      expect(hashEmail('user@example.com')).toBe(hashEmail('user@example.com'));
    });

    it('normalises to lowercase', () => {
      expect(hashEmail('User@EXAMPLE.COM')).toBe(hashEmail('user@example.com'));
    });

    it('trims leading/trailing whitespace', () => {
      expect(hashEmail('  user@example.com  ')).toBe(hashEmail('user@example.com'));
    });

    it('produces a 64-character hex string (SHA-256)', () => {
      const result = hashEmail('user@example.com');
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hashes for different emails', () => {
      expect(hashEmail('a@example.com')).not.toBe(hashEmail('b@example.com'));
    });
  });
});
