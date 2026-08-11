/**
 * InMemoryEnvelopeCipher – test double for EnvelopeCipherPort.
 *
 * Uses AES-256-GCM with a static 32-byte test key.
 * Never use in production — the key is predictable.
 */

import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { EnvelopeCipherPort, EncryptParams, EncryptResult, DecryptParams } from './envelope-cipher';

const TEST_KEY = Buffer.alloc(32, 0xab);
const IV_BYTES = 12;
const TAG_BYTES = 16;

@Injectable()
export class InMemoryEnvelopeCipher implements EnvelopeCipherPort {
  async encrypt(params: EncryptParams): Promise<EncryptResult> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', TEST_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(params.plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = Buffer.concat([iv, tag, encrypted]);
    return { ciphertext: envelope, keyVersion: 1 };
  }

  async decrypt(params: DecryptParams): Promise<Buffer> {
    const buf = params.ciphertext;
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', TEST_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
