/**
 * CredentialVaultService – envelope-encrypts Jira refresh tokens and stores
 * the ciphertext in AWS Secrets Manager.  The DB stores only an opaque
 * secret_ref; no plaintext ever touches disk or logs.
 *
 * Envelope format (delegated to KmsEnvelopeCipher):
 *   [1 byte version][4 LE bytes encDataKeyLen][encDataKey][12 iv][16 tag][ciphertext]
 *
 * Secret reference format: "jira/{tenantId}/{connectionId}"
 */

import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand,
  DeleteSecretCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import {
  ENVELOPE_CIPHER_PORT,
  EnvelopeCipherPort,
} from '@opsninja/crypto';

@Injectable()
export class CredentialVaultService {
  private readonly smClient: SecretsManagerClient;

  constructor(
    @Inject(ENVELOPE_CIPHER_PORT) private readonly cipher: EnvelopeCipherPort,
    private readonly config: ConfigService,
  ) {
    const region = this.config.get<string>('AWS_REGION', 'us-east-1');
    this.smClient = new SecretsManagerClient({ region });
  }

  /**
   * Encrypts the refresh token and stores ciphertext in Secrets Manager.
   * Returns the opaque secret reference (path stored in DB).
   */
  async storeRefreshToken(
    tenantId: string,
    connectionId: string,
    refreshToken: string,
  ): Promise<string> {
    const secretRef = this.buildSecretRef(tenantId, connectionId);
    const plaintext = Buffer.from(refreshToken, 'utf8');

    let ciphertext: Buffer;
    try {
      const result = await this.cipher.encrypt({ tenantId, plaintext });
      ciphertext = result.ciphertext;
      plaintext.fill(0);
    } catch {
      plaintext.fill(0);
      throw new ServiceUnavailableException({
        code: 'KEY_SERVICE_UNAVAILABLE',
        message: 'The key management service is temporarily unavailable. Retry later.',
      });
    }

    try {
      await this.smClient.send(
        new CreateSecretCommand({
          Name: secretRef,
          SecretBinary: ciphertext,
          Description: `Jira refresh token for connection ${connectionId} (tenant ${tenantId})`,
          Tags: [
            { Key: 'tenant_id', Value: tenantId },
            { Key: 'connection_id', Value: connectionId },
          ],
        }),
      );
    } catch (err: unknown) {
      const code = (err as { name?: string }).name;
      if (code === 'ResourceExistsException') {
        // On reconnect: overwrite via update (using PutSecretValue is done in updateRefreshToken)
        await this.updateRefreshToken(tenantId, connectionId, refreshToken);
        return secretRef;
      }
      throw new ServiceUnavailableException({
        code: 'SECRETS_MANAGER_UNAVAILABLE',
        message: 'Unable to store credential. Retry later.',
      });
    }

    return secretRef;
  }

  /**
   * Updates an existing secret in Secrets Manager with a new refresh token.
   */
  async updateRefreshToken(
    tenantId: string,
    connectionId: string,
    refreshToken: string,
  ): Promise<void> {
    const secretRef = this.buildSecretRef(tenantId, connectionId);
    const plaintext = Buffer.from(refreshToken, 'utf8');

    let ciphertext: Buffer;
    try {
      const result = await this.cipher.encrypt({ tenantId, plaintext });
      ciphertext = result.ciphertext;
      plaintext.fill(0);
    } catch {
      plaintext.fill(0);
      throw new ServiceUnavailableException({
        code: 'KEY_SERVICE_UNAVAILABLE',
        message: 'The key management service is temporarily unavailable. Retry later.',
      });
    }

    const { PutSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
    try {
      await this.smClient.send(
        new PutSecretValueCommand({
          SecretId: secretRef,
          SecretBinary: ciphertext,
        }),
      );
    } catch {
      throw new ServiceUnavailableException({
        code: 'SECRETS_MANAGER_UNAVAILABLE',
        message: 'Unable to update credential. Retry later.',
      });
    }
  }

  /**
   * Retrieves and decrypts the refresh token for a connection.
   */
  async getRefreshToken(tenantId: string, connectionId: string): Promise<string> {
    const secretRef = this.buildSecretRef(tenantId, connectionId);

    let ciphertext: Buffer;
    try {
      const result = await this.smClient.send(
        new GetSecretValueCommand({ SecretId: secretRef }),
      );
      if (!result.SecretBinary) {
        throw new Error('Secret has no binary value');
      }
      ciphertext = Buffer.from(result.SecretBinary);
    } catch (err: unknown) {
      if (err instanceof ResourceNotFoundException) {
        throw new ServiceUnavailableException({
          code: 'CREDENTIAL_NOT_FOUND',
          message: 'Stored credential not found. The connection may need to be re-authorized.',
        });
      }
      throw new ServiceUnavailableException({
        code: 'SECRETS_MANAGER_UNAVAILABLE',
        message: 'Unable to retrieve credential. Retry later.',
      });
    }

    try {
      const plaintext = await this.cipher.decrypt({ tenantId, ciphertext });
      const token = plaintext.toString('utf8');
      plaintext.fill(0);
      return token;
    } catch {
      throw new ServiceUnavailableException({
        code: 'KEY_SERVICE_UNAVAILABLE',
        message: 'Unable to decrypt credential. Retry later.',
      });
    }
  }

  /**
   * Crypto-shreds the data key by deleting the secret from Secrets Manager.
   * After this call the ciphertext cannot be decrypted even if recovered from disk.
   */
  async deleteSecret(tenantId: string, connectionId: string): Promise<void> {
    const secretRef = this.buildSecretRef(tenantId, connectionId);
    try {
      await this.smClient.send(
        new DeleteSecretCommand({
          SecretId: secretRef,
          // Immediate deletion; no recovery window needed for crypto-shred
          ForceDeleteWithoutRecovery: true,
        }),
      );
    } catch (err: unknown) {
      if (err instanceof ResourceNotFoundException) {
        return; // Already deleted — idempotent
      }
      throw new ServiceUnavailableException({
        code: 'SECRETS_MANAGER_UNAVAILABLE',
        message: 'Unable to delete credential. Retry later.',
      });
    }
  }

  private buildSecretRef(tenantId: string, connectionId: string): string {
    return `jira/${tenantId}/${connectionId}`;
  }
}
