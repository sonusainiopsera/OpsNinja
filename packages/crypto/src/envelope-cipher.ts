/**
 * EnvelopeCipher — port for KMS envelope encryption.
 *
 * Production: KmsEnvelopeCipher — GenerateDataKey per-tenant, AES-256-GCM local encrypt.
 * Test: InMemoryEnvelopeCipher — deterministic XOR stub (no KMS dependency).
 *
 * Security constraints:
 *  - Plaintext secret never persisted; exists only in memory during encryption.
 *  - Encrypted output is Base64-encoded for safe text storage.
 *  - Encryption context includes tenantId so a ciphertext cannot be decrypted
 *    under a different tenant's key context.
 */

import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export const ENVELOPE_CIPHER = Symbol('ENVELOPE_CIPHER');

export interface EncryptResult {
  ciphertext: string;
  keyVersion: number;
}

export interface EnvelopeCipherPort {
  encrypt(plaintext: string, tenantId: string): Promise<EncryptResult>;
  decrypt(ciphertext: string, tenantId: string): Promise<string>;
}

// ── KMS-backed production implementation ─────────────────────────────────────

const AES_KEY_SPEC = 'AES_256';
const GCM_IV_LEN = 12;
const GCM_TAG_LEN = 16;

export class KmsEnvelopeCipher implements EnvelopeCipherPort {
  private readonly kms: KMSClient;

  constructor(
    private readonly keyArn: string,
    private readonly keyVersion: number = 1,
  ) {
    this.kms = new KMSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
  }

  async encrypt(plaintext: string, tenantId: string): Promise<EncryptResult> {
    const { Plaintext: dataKey, CiphertextBlob: encryptedDataKey } = await this.kms.send(
      new GenerateDataKeyCommand({
        KeyId: this.keyArn,
        KeySpec: AES_KEY_SPEC,
        EncryptionContext: { tenant_id: tenantId },
      }),
    );

    if (!dataKey || !encryptedDataKey) {
      throw new Error('KMS GenerateDataKey returned empty result');
    }

    const iv = randomBytes(GCM_IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(dataKey), iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Wire: <IV 12B> + <TAG 16B> + <ENC data> + <ENC data key>
    const payload = Buffer.concat([
      iv, tag, enc,
      Buffer.from('::'),
      Buffer.from(encryptedDataKey),
    ]);

    // Zero the data key from memory
    Buffer.from(dataKey).fill(0);

    return { ciphertext: payload.toString('base64'), keyVersion: this.keyVersion };
  }

  async decrypt(ciphertext: string, tenantId: string): Promise<string> {
    const buf = Buffer.from(ciphertext, 'base64');
    const separatorIdx = buf.indexOf(Buffer.from('::'), GCM_IV_LEN + GCM_TAG_LEN);
    if (separatorIdx === -1) throw new Error('Invalid ciphertext envelope format');

    const iv = buf.subarray(0, GCM_IV_LEN);
    const tag = buf.subarray(GCM_IV_LEN, GCM_IV_LEN + GCM_TAG_LEN);
    const enc = buf.subarray(GCM_IV_LEN + GCM_TAG_LEN, separatorIdx);
    const encDataKey = buf.subarray(separatorIdx + 2);

    const { Plaintext: dataKey } = await this.kms.send(
      new DecryptCommand({
        CiphertextBlob: encDataKey,
        KeyId: this.keyArn,
        EncryptionContext: { tenant_id: tenantId },
      }),
    );

    if (!dataKey) throw new Error('KMS Decrypt returned empty data key');

    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(dataKey), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');

    Buffer.from(dataKey).fill(0);
    return plaintext;
  }
}

// ── In-memory stub for tests ──────────────────────────────────────────────────

export class InMemoryEnvelopeCipher implements EnvelopeCipherPort {
  private readonly store = new Map<string, string>();

  async encrypt(plaintext: string, _tenantId: string): Promise<EncryptResult> {
    const id = randomBytes(8).toString('hex');
    const ciphertext = `stub:${id}:${Buffer.from(plaintext).toString('base64')}`;
    this.store.set(ciphertext, plaintext);
    return { ciphertext, keyVersion: 1 };
  }

  async decrypt(ciphertext: string, _tenantId: string): Promise<string> {
    const cached = this.store.get(ciphertext);
    if (cached !== undefined) return cached;
    // Fallback: decode from stub format
    const parts = ciphertext.split(':');
    if (parts.length >= 3 && parts[0] === 'stub') {
      return Buffer.from(parts[2]!, 'base64').toString('utf8');
    }
    throw new Error('InMemoryEnvelopeCipher: unknown ciphertext');
  }
}
