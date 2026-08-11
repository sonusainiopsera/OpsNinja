import { CsatTokenService } from '../csat-token.service';

describe('CsatTokenService', () => {
  let service: CsatTokenService;
  let mockNow: Date;

  beforeEach(() => {
    mockNow = new Date('2025-06-01T12:00:00Z');
    service = new CsatTokenService(() => mockNow);
  });

  describe('generateRawToken', () => {
    it('returns a 43-char base64url string', () => {
      const token = service.generateRawToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('returns unique tokens on repeated calls', () => {
      const tokens = new Set(Array.from({ length: 100 }, () => service.generateRawToken()));
      expect(tokens.size).toBe(100);
    });
  });

  describe('hashToken', () => {
    it('returns a 64-char lowercase hex string', () => {
      const hash = service.hashToken('sometoken');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic for the same input', () => {
      const a = service.hashToken('abc');
      const b = service.hashToken('abc');
      expect(a).toBe(b);
    });

    it('produces different hashes for different inputs', () => {
      expect(service.hashToken('abc')).not.toBe(service.hashToken('abd'));
    });
  });

  describe('verifyHash', () => {
    it('returns true when hashes match', () => {
      const raw = service.generateRawToken();
      const hash = service.hashToken(raw);
      expect(service.verifyHash(hash, hash)).toBe(true);
    });

    it('returns false when hashes differ', () => {
      const h1 = service.hashToken('token1');
      const h2 = service.hashToken('token2');
      expect(service.verifyHash(h1, h2)).toBe(false);
    });

    it('returns false for different-length inputs', () => {
      expect(service.verifyHash('short', 'a'.repeat(64))).toBe(false);
    });
  });

  describe('isExpired', () => {
    it('returns false when expiresAt is in the future', () => {
      const future = new Date(mockNow.getTime() + 1000);
      expect(service.isExpired(future)).toBe(false);
    });

    it('returns true when expiresAt equals now (boundary)', () => {
      expect(service.isExpired(mockNow)).toBe(true);
    });

    it('returns true when expiresAt is in the past', () => {
      const past = new Date(mockNow.getTime() - 1000);
      expect(service.isExpired(past)).toBe(true);
    });
  });

  describe('computeExpiresAt', () => {
    it('adds the correct number of days', () => {
      const from = new Date('2025-06-01T00:00:00Z');
      const expires = service.computeExpiresAt(from, 14);
      expect(expires.toISOString()).toBe('2025-06-15T00:00:00.000Z');
    });
  });
});
