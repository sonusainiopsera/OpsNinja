/**
 * CredentialVaultPort — port for encrypted credential storage.
 *
 * Production: AwsSecretVaultAdapter — KMS envelope-encrypts the credential and
 * stores the ciphertext in AWS Secrets Manager; DB holds only the secret_ref.
 * Deleting the secret crypto-shreds the credential (no key, no decryption).
 *
 * Test: InMemorySecretVaultAdapter — no-op encryption, Map-backed storage.
 *
 * Security constraints:
 *  - Plaintext credential exists only in memory during store/retrieve operations.
 *  - secret_ref is an opaque string (SM secret name); it never contains the credential.
 *  - Encryption context includes tenantId so a ciphertext from tenant A cannot be
 *    decrypted under tenant B's key context.
 */

import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand,
  DeleteSecretCommand,
  ResourceExistsException,
  UpdateSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import { KmsEnvelopeCipher } from '@opsninja/crypto';

export const CREDENTIAL_VAULT = Symbol('CREDENTIAL_VAULT');

export interface CredentialVaultPort {
  /**
   * Encrypt and persist the credential under the given secret name.
   * Returns an opaque secret_ref (the Secrets Manager secret name).
   */
  store(secretName: string, plaintext: string, tenantId: string): Promise<string>;

  /** Decrypt and return the credential stored under secretRef. */
  retrieve(secretRef: string, tenantId: string): Promise<string>;

  /**
   * Delete the stored secret, crypto-shredding the credential.
   * Any attempt to decrypt after deletion returns an error.
   */
  delete(secretRef: string): Promise<void>;
}

// ── Production adapter ────────────────────────────────────────────────────────

export class AwsSecretVaultAdapter implements CredentialVaultPort {
  private readonly sm: SecretsManagerClient;
  private readonly cipher: KmsEnvelopeCipher;

  constructor(kmsKeyArn: string) {
    this.sm = new SecretsManagerClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
    this.cipher = new KmsEnvelopeCipher(kmsKeyArn);
  }

  async store(secretName: string, plaintext: string, tenantId: string): Promise<string> {
    const { ciphertext } = await this.cipher.encrypt(plaintext, tenantId);

    try {
      await this.sm.send(new CreateSecretCommand({
        Name: secretName,
        SecretString: ciphertext,
        Tags: [{ Key: 'tenant_id', Value: tenantId }],
      }));
    } catch (err) {
      if (err instanceof ResourceExistsException) {
        // Secret already exists — update it (re-connect flow).
        await this.sm.send(new UpdateSecretCommand({
          SecretId: secretName,
          SecretString: ciphertext,
        }));
      } else {
        throw err;
      }
    }

    return secretName;
  }

  async retrieve(secretRef: string, tenantId: string): Promise<string> {
    const result = await this.sm.send(new GetSecretValueCommand({ SecretId: secretRef }));
    if (!result.SecretString) {
      throw new Error(`Secret ${secretRef} is empty or has no string value`);
    }
    return this.cipher.decrypt(result.SecretString, tenantId);
  }

  async delete(secretRef: string): Promise<void> {
    await this.sm.send(new DeleteSecretCommand({
      SecretId: secretRef,
      // Immediate deletion — no recovery window. This is the crypto-shred.
      ForceDeleteWithoutRecovery: true,
    }));
  }
}

// ── In-memory stub for tests ──────────────────────────────────────────────────

export class InMemorySecretVaultAdapter implements CredentialVaultPort {
  private readonly _store = new Map<string, string>();

  async store(secretName: string, plaintext: string, _tenantId: string): Promise<string> {
    this._store.set(secretName, plaintext);
    return secretName;
  }

  async retrieve(secretRef: string, _tenantId: string): Promise<string> {
    const value = this._store.get(secretRef);
    if (value === undefined) throw new Error(`Secret not found: ${secretRef}`);
    return value;
  }

  async delete(secretRef: string): Promise<void> {
    this._store.delete(secretRef);
  }
}
