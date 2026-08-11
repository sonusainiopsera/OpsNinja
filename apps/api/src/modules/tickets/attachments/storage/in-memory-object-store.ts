/**
 * InMemoryObjectStore — in-process fake ObjectStorePort for unit tests.
 *
 * Stores objects in a Map so tests can pre-populate content and assert
 * that presignPost/presignGet/deleteObject are called correctly without
 * any AWS credentials or network access.
 *
 * NOT for production use.
 */

import type {
  ObjectStorePort,
  PresignPostResult,
  HeadObjectResult,
} from './object-store.port';

export class InMemoryObjectStore implements ObjectStorePort {
  /** Backing store: key → Buffer of object content. */
  private readonly store = new Map<string, Buffer>();

  /** Pre-populate an object for tests (simulates a completed S3 upload). */
  put(key: string, content: Buffer): void {
    this.store.set(key, content);
  }

  async presignPost(
    key: string,
    maxBytes: number,
    expiresIn: number,
    kmsKeyId?: string,
  ): Promise<PresignPostResult> {
    return {
      url: `https://fake-s3.local/test-bucket`,
      fields: {
        key,
        'Content-Type': 'application/octet-stream',
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': kmsKeyId ?? 'test-kms-key',
        'Content-Length-Range': `1,${maxBytes}`,
        'X-Amz-Expires': String(expiresIn),
      },
      key,
    };
  }

  async presignGet(key: string, expiresIn: number): Promise<string> {
    return `https://fake-s3.local/test-bucket/${encodeURIComponent(key)}?X-Amz-Expires=${expiresIn}`;
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    const obj = this.store.get(key);
    if (!obj) return { exists: false, contentLength: null };
    return { exists: true, contentLength: obj.length };
  }

  async getRange(key: string, start: number, end: number): Promise<Buffer | null> {
    const obj = this.store.get(key);
    if (!obj) return null;
    return obj.subarray(start, end + 1);
  }

  async deleteObject(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Inspect store contents in tests. */
  has(key: string): boolean {
    return this.store.has(key);
  }
}
