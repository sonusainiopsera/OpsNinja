/**
 * WebhookSecretService — manages signing secret generation, encryption and rotation.
 *
 * Security constraints (Restricted-tier):
 *  - Plaintext secret exists only in the creation/rotation response scope and
 *    in memory during signing. It MUST NOT be logged, exported or returned by read endpoints.
 *  - Secrets are 32 bytes of cryptographically secure randomness, hex-encoded (64 chars).
 *  - Stored as ciphertext via EnvelopeCipherPort (KMS envelope encryption).
 *  - Rotation retains the previous secret for a configurable grace period so receivers
 *    can roll over without dropped verifications.
 *  - Invoking rotation twice inside the grace window discards the older previous secret.
 */

import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { EnvelopeCipherPort } from '@opsninja/crypto';
import { ENVELOPE_CIPHER } from '@opsninja/crypto';

export const DEFAULT_GRACE_HOURS = 24;

export interface SecretBundle {
  /** Plaintext secret — expose only in the creating/rotating response, never elsewhere. */
  plaintext: string;
  /** Encrypted ciphertext to persist. */
  ciphertext: string;
  keyVersion: number;
}

export interface RotationResult {
  newBundle: SecretBundle;
  previousCiphertext: string;
  previousExpiresAt: Date;
}

@Injectable()
export class WebhookSecretService {
  private readonly logger = new Logger(WebhookSecretService.name);

  constructor(
    @Inject(ENVELOPE_CIPHER)
    private readonly cipher: EnvelopeCipherPort,
  ) {}

  /** Generate a new 32-byte secret and encrypt it under the tenant's KMS data key. */
  async generateSecret(tenantId: string): Promise<SecretBundle> {
    const plaintext = randomBytes(32).toString('hex');
    try {
      const { ciphertext, keyVersion } = await this.cipher.encrypt(plaintext, tenantId);
      return { plaintext, ciphertext, keyVersion };
    } catch (err) {
      this.logger.error('KMS unavailable during secret generation', {
        tenantId,
        message: (err as Error).message,
      });
      throw new ServiceUnavailableException({
        error: {
          code: 'KEY_SERVICE_UNAVAILABLE',
          message: 'The key management service is temporarily unavailable. Please retry.',
          traceId: null,
        },
      });
    }
  }

  /** Rotate an existing secret, retaining the previous one for the grace period. */
  async rotateSecret(
    tenantId: string,
    currentCiphertext: string,
    gracePeriodHours = DEFAULT_GRACE_HOURS,
  ): Promise<RotationResult> {
    const newBundle = await this.generateSecret(tenantId);
    const previousExpiresAt = new Date(Date.now() + gracePeriodHours * 60 * 60 * 1000);
    return {
      newBundle,
      previousCiphertext: currentCiphertext,
      previousExpiresAt,
    };
  }

  /** Decrypt a stored ciphertext to retrieve the plaintext signing secret. */
  async decryptSecret(ciphertext: string, tenantId: string): Promise<string> {
    return this.cipher.decrypt(ciphertext, tenantId);
  }
}
