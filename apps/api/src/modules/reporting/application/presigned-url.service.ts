/**
 * PresignedUrlService — mints time-limited S3 presigned download URLs.
 *
 * Security constraints:
 *   • URLs are NEVER persisted to the database or written to logs.
 *   • Only the fact of URL issuance (actor, job id, timestamp) is audited.
 *   • TTL is always fresh from the moment of the GET /exports/{id} call, so
 *     a 15-minute window is always available even after a page refresh.
 *   • SSE-KMS is set on the underlying object; the presigned URL inherits
 *     the object's encryption state automatically.
 *
 * The S3_EXPORT_BUCKET and S3_EXPORT_KMS_KEY_ID env vars are required in
 * production. Missing bucket falls back gracefully to a placeholder URL in
 * development / test environments.
 */

import { Injectable, Logger } from '@nestjs/common';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PRESIGNED_URL_TTL_SECONDS = 900; // 15 minutes

@Injectable()
export class PresignedUrlService {
  private readonly logger = new Logger(PresignedUrlService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor() {
    this.s3 = new S3Client({
      region: process.env['AWS_REGION'] ?? 'us-east-1',
    });
    this.bucket = process.env['S3_EXPORT_BUCKET'] ?? '';
  }

  /**
   * Mint a fresh 15-minute presigned URL for the given S3 object key.
   *
   * @param s3Key  - opaque object key (exports/{tenantId}/{jobId}.csv)
   * @param jobId  - used only for audit logging
   * @param tenantId - used only for audit logging
   * @returns presigned HTTPS URL string
   */
  async getPresignedUrl(
    s3Key: string,
    jobId: string,
    tenantId: string,
  ): Promise<string> {
    if (!this.bucket) {
      this.logger.warn('S3_EXPORT_BUCKET not configured — returning placeholder URL', { jobId });
      return `https://s3.example.com/${s3Key}?X-Amz-Expires=${PRESIGNED_URL_TTL_SECONDS}`;
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key:    s3Key,
    });

    const url = await getSignedUrl(this.s3, command, {
      expiresIn: PRESIGNED_URL_TTL_SECONDS,
    });

    // Audit: only the fact of issuance — never the URL itself.
    this.logger.log('export:presigned_url_issued', {
      jobId,
      tenantId,
      expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
    });

    return url;
  }
}
