/**
 * S3ObjectStore — production ObjectStorePort backed by AWS S3.
 *
 * Requires env vars:
 *   S3_ATTACHMENTS_BUCKET     — bucket name
 *   S3_ATTACHMENTS_KMS_KEY_ID — KMS key alias or ARN for SSE-KMS
 *   AWS_REGION                — AWS region (default us-east-1)
 *
 * Follows the same pattern as PresignedUrlService in the reporting module.
 * All objects are server-side encrypted with KMS; no object is publicly readable.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreatePresignedPostCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  ObjectStorePort,
  PresignPostResult,
  HeadObjectResult,
} from './object-store.port';

@Injectable()
export class S3ObjectStore implements ObjectStorePort {
  private readonly logger = new Logger(S3ObjectStore.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly kmsKeyId: string;

  constructor() {
    this.s3 = new S3Client({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
    this.bucket = process.env['S3_ATTACHMENTS_BUCKET'] ?? '';
    this.kmsKeyId = process.env['S3_ATTACHMENTS_KMS_KEY_ID'] ?? '';
  }

  async presignPost(
    key: string,
    maxBytes: number,
    expiresIn: number,
    kmsKeyId?: string,
  ): Promise<PresignPostResult> {
    const effectiveKmsKey = kmsKeyId ?? this.kmsKeyId;

    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, maxBytes],
        { key },
        { 'x-amz-server-side-encryption': 'aws:kms' },
        { 'x-amz-server-side-encryption-aws-kms-key-id': effectiveKmsKey },
      ],
      Expires: expiresIn,
      Fields: {
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': effectiveKmsKey,
      },
    });

    return { url, fields: fields as Record<string, string>, key };
  }

  async presignGet(key: string, expiresIn: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    try {
      const result = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        exists: true,
        contentLength: result.ContentLength ?? null,
      };
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      if (code === 'NotFound' || code === 'NoSuchKey') {
        return { exists: false, contentLength: null };
      }
      throw err;
    }
  }

  async getRange(key: string, start: number, end: number): Promise<Buffer | null> {
    try {
      const result = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=${start}-${end}`,
        }),
      );
      if (!result.Body) return null;
      const chunks: Uint8Array[] = [];
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log('s3:object_deleted', { key, bucket: this.bucket });
  }
}

// ---------------------------------------------------------------------------
// createPresignedPost helper (SDK v3 compatible)
// ---------------------------------------------------------------------------

async function createPresignedPost(
  s3: S3Client,
  params: {
    Bucket: string;
    Key: string;
    Conditions: unknown[];
    Expires: number;
    Fields: Record<string, string>;
  },
): Promise<{ url: string; fields: Record<string, string> }> {
  const command = new CreatePresignedPostCommand({
    Bucket: params.Bucket,
    Key: params.Key,
    Conditions: params.Conditions as Parameters<typeof CreatePresignedPostCommand>[0]['Conditions'],
    Expires: params.Expires,
    Fields: params.Fields,
  });
  const result = await s3.send(command);
  return {
    url: result.url ?? '',
    fields: (result.fields ?? {}) as Record<string, string>,
  };
}
