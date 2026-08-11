/**
 * KmsEnvelopeCipher – production adapter using AWS KMS GenerateDataKey.
 *
 * Flow (encrypt):
 *  1. Call KMS GenerateDataKey for a 256-bit AES key with encryption context {tenant_id}.
 *  2. Encrypt the plaintext with AES-256-GCM using the plaintext data key.
 *  3. Zeroize the plaintext data key.
 *  4. Return: {encryptedDataKey (KMS ciphertext) || iv || tag || ciphertext}.
 *
 * Flow (decrypt):
 *  1. Parse the envelope blob.
 *  2. Call KMS Decrypt with the same encryption context.
 *  3. Decrypt with AES-256-GCM.
 *  4. Zeroize the plaintext data key.
 *
 * Credentials come from the pod's IRSA role; no credentials are hard-coded.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { EnvelopeCipherPort, EncryptParams, EncryptResult, DecryptParams } from './envelope-cipher';

const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DATA_KEY_CIPHERTEXT_FIELD_BYTES = 4; // uint32 LE length prefix

@Injectable()
export class KmsEnvelopeCipher implements EnvelopeCipherPort {
  private readonly client: KMSClient;
  private readonly keyId: string;
  private readonly keyVersion: number;

  constructor(config: ConfigService) {
    this.client = new KMSClient({ region: config.get<string>('AWS_REGION', 'us-east-1') });
    this.keyId = config.getOrThrow<string>('KMS_WEBHOOK_SECRET_KEY_ID');
    this.keyVersion = config.get<number>('KMS_WEBHOOK_SECRET_KEY_VERSION', 1);
  }

  async encrypt(params: EncryptParams): Promise<EncryptResult> {
    const { KeyCiphertext, Plaintext } = await this.client.send(
      new GenerateDataKeyCommand({
        KeyId: this.keyId,
        KeySpec: 'AES_256',
        EncryptionContext: { tenant_id: params.tenantId },
      }),
    );

    if (!KeyCiphertext || !Plaintext) {
      throw new Error('KMS GenerateDataKey returned incomplete response');
    }

    const dataKey = Buffer.from(Plaintext);
    const iv = randomBytes(IV_BYTES);

    try {
      const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
      const encrypted = Buffer.concat([cipher.update(params.plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();

      // Envelope format:
      // [1 byte version] [4 bytes LE: encDataKeyLen] [encDataKey] [12 bytes iv] [16 bytes tag] [ciphertext]
      const encDataKey = Buffer.from(KeyCiphertext);
      const lenBuf = Buffer.allocUnsafe(DATA_KEY_CIPHERTEXT_FIELD_BYTES);
      lenBuf.writeUInt32LE(encDataKey.length, 0);

      const envelope = Buffer.concat([
        Buffer.from([ENVELOPE_VERSION]),
        lenBuf,
        encDataKey,
        iv,
        tag,
        encrypted,
      ]);

      return { ciphertext: envelope, keyVersion: this.keyVersion };
    } finally {
      dataKey.fill(0);
    }
  }

  async decrypt(params: DecryptParams): Promise<Buffer> {
    const buf = params.ciphertext;
    let offset = 0;

    const version = buf.readUInt8(offset++);
    if (version !== ENVELOPE_VERSION) {
      throw new Error(`Unknown envelope version: ${version}`);
    }

    const encDataKeyLen = buf.readUInt32LE(offset);
    offset += DATA_KEY_CIPHERTEXT_FIELD_BYTES;

    const encDataKey = buf.subarray(offset, offset + encDataKeyLen);
    offset += encDataKeyLen;

    const iv = buf.subarray(offset, offset + IV_BYTES);
    offset += IV_BYTES;

    const tag = buf.subarray(offset, offset + TAG_BYTES);
    offset += TAG_BYTES;

    const ciphertext = buf.subarray(offset);

    const { Plaintext } = await this.client.send(
      new DecryptCommand({
        CiphertextBlob: encDataKey,
        EncryptionContext: { tenant_id: params.tenantId },
      }),
    );

    if (!Plaintext) throw new Error('KMS Decrypt returned no plaintext');

    const dataKey = Buffer.from(Plaintext);
    try {
      const decipher = createDecipheriv('aes-256-gcm', dataKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } finally {
      dataKey.fill(0);
    }
  }
}
