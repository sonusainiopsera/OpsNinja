/**
 * EnvelopeCipher – ports-and-adapters interface for envelope encryption.
 *
 * Production adapter: KmsEnvelopeCipher (uses AWS KMS GenerateDataKey).
 * Test adapter: InMemoryEnvelopeCipher (AES-256-GCM with a static key).
 *
 * The encryption context always includes tenant_id so a ciphertext from
 * one tenant cannot be decrypted in another tenant's context.
 */

export const ENVELOPE_CIPHER_PORT = 'ENVELOPE_CIPHER_PORT';

export interface EncryptParams {
  plaintext: Buffer;
  /** Included in KMS encryption context for tenant isolation. */
  tenantId: string;
}

export interface EncryptResult {
  /** Base64-encoded envelope blob (includes data key ciphertext + ciphertext). */
  ciphertext: Buffer;
  /** KMS key version / alias used. Stored for auditing and rotation. */
  keyVersion: number;
}

export interface DecryptParams {
  ciphertext: Buffer;
  tenantId: string;
  keyVersion: number;
}

export interface EnvelopeCipherPort {
  encrypt(params: EncryptParams): Promise<EncryptResult>;
  decrypt(params: DecryptParams): Promise<Buffer>;
}
