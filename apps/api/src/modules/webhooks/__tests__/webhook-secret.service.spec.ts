import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookSecretService } from '../webhook-secret.service';
import { InMemoryEnvelopeCipher } from '@opsninja/crypto';

function makeService(gracePeriodHours = 24) {
  const config = {
    get: jest.fn((key: string, def: unknown) => (key === 'WEBHOOK_SECRET_GRACE_HOURS' ? gracePeriodHours : def)),
    getOrThrow: jest.fn(),
  } as unknown as ConfigService;

  const cipher = new InMemoryEnvelopeCipher();
  return new WebhookSecretService(cipher, config);
}

describe('WebhookSecretService', () => {
  describe('generateSecret', () => {
    it('returns a 32-byte (43-char base64url) secret', async () => {
      const svc = makeService();
      const result = await svc.generateSecret('tenant-1');
      // 32 bytes → base64url without padding = ceil(32 * 4/3) chars ≈ 43
      expect(typeof result.plaintextBase64).toBe('string');
      const decoded = Buffer.from(result.plaintextBase64, 'base64url');
      expect(decoded.length).toBe(32);
    });

    it('returns a non-empty ciphertext buffer', async () => {
      const svc = makeService();
      const result = await svc.generateSecret('tenant-1');
      expect(result.ciphertext).toBeInstanceOf(Buffer);
      expect(result.ciphertext.length).toBeGreaterThan(0);
    });

    it('round-trips: decrypt(encrypt(plaintext)) equals original', async () => {
      const cipher = new InMemoryEnvelopeCipher();
      const config = {
        get: jest.fn((k: string, d: unknown) => d),
        getOrThrow: jest.fn(),
      } as unknown as ConfigService;
      const svc = new WebhookSecretService(cipher, config);

      const { plaintextBase64, ciphertext } = await svc.generateSecret('tenant-x');
      const decrypted = await svc.decryptSecret('tenant-x', ciphertext);
      expect(decrypted.toString('base64url')).toBe(plaintextBase64);
    });

    it('throws ServiceUnavailableException when KMS fails', async () => {
      const config = {
        get: jest.fn((k: string, d: unknown) => d),
        getOrThrow: jest.fn(),
      } as unknown as ConfigService;
      const brokenCipher = {
        encrypt: jest.fn().mockRejectedValue(new Error('KMS down')),
        decrypt: jest.fn(),
      };
      const svc = new WebhookSecretService(brokenCipher as never, config);
      await expect(svc.generateSecret('tenant-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('rotateSecret', () => {
    it('returns a previousSecretExpiresAt in the future', async () => {
      const svc = makeService(24);
      const before = Date.now();
      const result = await svc.rotateSecret('tenant-1');
      const after = Date.now();

      const expiry = result.previousSecretExpiresAt.getTime();
      expect(expiry).toBeGreaterThan(before + 23 * 3600 * 1000);
      expect(expiry).toBeLessThan(after + 25 * 3600 * 1000);
    });

    it('respects custom grace period', async () => {
      const svc = makeService(1); // 1 hour
      const before = Date.now();
      const result = await svc.rotateSecret('tenant-1');
      const expiry = result.previousSecretExpiresAt.getTime();
      expect(expiry).toBeGreaterThan(before + 59 * 60 * 1000);
      expect(expiry).toBeLessThan(before + 61 * 60 * 1000);
    });

    it('generates a different secret each time', async () => {
      const svc = makeService();
      const r1 = await svc.rotateSecret('tenant-1');
      const r2 = await svc.rotateSecret('tenant-1');
      expect(r1.plaintextBase64).not.toBe(r2.plaintextBase64);
    });
  });
});
