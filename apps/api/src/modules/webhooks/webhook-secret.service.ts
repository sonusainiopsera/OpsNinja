/**
 * WebhookSecretService – manages webhook signing secret lifecycle.
 *
 * Secrets are 32 bytes of CSPRNG output (base64url-encoded for readability),
 * stored envelope-encrypted with a per-tenant KMS data key.
 * Plaintext is held only in the immediate response and zeroized after.
 *
 * Rotation keeps the previous secret valid for a configurable grace period
 * (default 24 hours) so receivers can roll over without dropped verifications.
 */

import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import {
  ENVELOPE_CIPHER_PORT,
  EnvelopeCipherPort,
} from '@opsninja/crypto';

export interface GeneratedSecret {
  plaintextBase64: string;
  ciphertext: Buffer;
  keyVersion: number;
}

export interface RotationResult extends GeneratedSecret {
  previousSecretExpiresAt: Date;
}

@Injectable()
export class WebhookSecretService {
  private readonly gracePeriodMs: number;

  constructor(
    @Inject(ENVELOPE_CIPHER_PORT) private readonly cipher: EnvelopeCipherPort,
    private readonly config: ConfigService,
  ) {
    const hours = this.config.get<number>('WEBHOOK_SECRET_GRACE_HOURS', 24);
    this.gracePeriodMs = hours * 60 * 60 * 1000;
  }

  /**
   * Generates a new 32-byte signing secret, encrypts it, and returns the
   * plaintext for inclusion in the creation response (only time it is exposed).
   *
   * @throws ServiceUnavailableException if KMS is unavailable.
   */
  async generateSecret(tenantId: string): Promise<GeneratedSecret> {
    const raw = randomBytes(32);
    const plaintextBase64 = raw.toString('base64url');
    try {
      const { ciphertext, keyVersion } = await this.cipher.encrypt({
        tenantId,
        plaintext: raw,
      });
      raw.fill(0);
      return { plaintextBase64, ciphertext, keyVersion };
    } catch (err) {
      raw.fill(0);
      throw new ServiceUnavailableException({
        code: 'KEY_SERVICE_UNAVAILABLE',
        message: 'The key management service is temporarily unavailable. Retry later.',
      });
    }
  }

  /**
   * Generates a new secret for rotation, returning the grace-period expiry.
   * The caller is responsible for storing the previous ciphertext atomically.
   */
  async rotateSecret(tenantId: string): Promise<RotationResult> {
    const generated = await this.generateSecret(tenantId);
    const previousSecretExpiresAt = new Date(Date.now() + this.gracePeriodMs);
    return { ...generated, previousSecretExpiresAt };
  }

  /**
   * Decrypts a stored secret ciphertext back to its plaintext bytes.
   * Used only during delivery to sign the outgoing payload.
   */
  async decryptSecret(tenantId: string, ciphertext: Buffer): Promise<Buffer> {
    return this.cipher.decrypt({ tenantId, ciphertext });
  }
}
