import { WebhookSecretService, DEFAULT_GRACE_HOURS } from './webhook-secret.service';
import { InMemoryEnvelopeCipher } from '@opsninja/crypto';

describe('WebhookSecretService', () => {
  let service: WebhookSecretService;
  let cipher: InMemoryEnvelopeCipher;

  beforeEach(() => {
    cipher = new InMemoryEnvelopeCipher();
    service = new WebhookSecretService(cipher);
  });

  describe('generateSecret', () => {
    it('returns a 64-char hex plaintext (32 bytes)', async () => {
      const result = await service.generateSecret('tenant-1');
      expect(result.plaintext).toMatch(/^[0-9a-f]{64}$/);
    });

    it('plaintext decrypts back to the same value', async () => {
      const result = await service.generateSecret('tenant-1');
      const decrypted = await cipher.decrypt(result.ciphertext, 'tenant-1');
      expect(decrypted).toBe(result.plaintext);
    });

    it('generates unique secrets on each call', async () => {
      const a = await service.generateSecret('tenant-1');
      const b = await service.generateSecret('tenant-1');
      expect(a.plaintext).not.toBe(b.plaintext);
    });
  });

  describe('rotateSecret', () => {
    it('returns new bundle and sets previousExpiresAt in the future', async () => {
      const original = await service.generateSecret('tenant-1');
      const before = Date.now();
      const rotation = await service.rotateSecret('tenant-1', original.ciphertext);
      const after = Date.now();

      expect(rotation.previousCiphertext).toBe(original.ciphertext);
      expect(rotation.previousExpiresAt.getTime()).toBeGreaterThan(
        before + (DEFAULT_GRACE_HOURS - 1) * 3600_000,
      );
      expect(rotation.previousExpiresAt.getTime()).toBeLessThan(
        after + (DEFAULT_GRACE_HOURS + 1) * 3600_000,
      );
      expect(rotation.newBundle.plaintext).not.toBe(original.plaintext);
    });

    it('respects custom grace period hours', async () => {
      const original = await service.generateSecret('tenant-1');
      const rotation = await service.rotateSecret('tenant-1', original.ciphertext, 1);
      const expectedExpiry = Date.now() + 1 * 3600_000;
      // Within 5 seconds of expected
      expect(Math.abs(rotation.previousExpiresAt.getTime() - expectedExpiry)).toBeLessThan(5_000);
    });
  });

  describe('decryptSecret', () => {
    it('decrypts a previously encrypted secret', async () => {
      const { plaintext, ciphertext } = await service.generateSecret('tenant-1');
      const decrypted = await service.decryptSecret(ciphertext, 'tenant-1');
      expect(decrypted).toBe(plaintext);
    });
  });
});
