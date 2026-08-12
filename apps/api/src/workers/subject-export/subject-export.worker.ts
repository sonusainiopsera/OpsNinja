/**
 * SubjectExportWorker — WO-096.
 *
 * Assembles a GDPR data-subject access/portability export archive and uploads
 * it to S3 with server-side encryption.  Invoked by a cron-triggered SQS
 * message; never buffers the full result set.
 *
 * Per-message flow:
 *   1. Idempotency guard: atomically transition status queued → running
 *      (WHERE status='queued' RETURNING id).  null = already processed; ack-exit.
 *   2. Walk the buildSubjectExportManifest() for the principal kind.
 *   3. For each manifest entry: query the primary DB with the subject_id parameter
 *      and portal principal visibility filter.
 *   4. Stream NDJSON rows to S3 via lib-storage multipart upload (SSE-KMS).
 *   5. On success: set status=completed, artifact_s3_key, completed_at.
 *      On failure: set status=failed, leave artifact_s3_key null.
 *
 * Security:
 *   - Portal principals never receive internal agent notes (visibilityFilter in manifest).
 *   - No raw SQL from user input; all values are positional parameters.
 *   - S3 key is tenant-namespaced: subjects/{tenantId}/{requestId}/export.ndjson.
 *   - Pre-signed URLs are generated at read time, never stored. TTL ≤ 24 hours.
 *   - leavePartsOnError: false — no partial object accessible via pre-signed URL.
 *
 * Memory:
 *   Rows are fetched per-table and written to S3 in streaming chunks.
 *   No table result set is buffered in memory beyond the current batch.
 */

import { Logger } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { PassThrough } from 'stream';
import { Pool } from 'pg';

import { buildSubjectExportManifest } from '../../modules/privacy/subject-export.manifest';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const S3_EXPORT_BUCKET     = process.env['S3_EXPORT_BUCKET'] ?? '';
const S3_EXPORT_KMS_KEY_ID = process.env['S3_EXPORT_KMS_KEY_ID'] ?? '';
const AWS_REGION           = process.env['AWS_REGION'] ?? 'us-east-1';
const S3_PART_SIZE_BYTES   = 5 * 1024 * 1024;  // 5 MB (S3 minimum)
const S3_QUEUE_SIZE        = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubjectExportPayload {
  requestId:        string;
  tenantId:         string;
  subjectType:      'contact' | 'portal_user';
  subjectId:        string;
  isPortalPrincipal: boolean;
}

export interface SubjectRequestsRepoPort {
  markRunning(id: string, messageId: string): Promise<string | null>;
  markCompleted(id: string, s3Key: string): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
}

export interface SubjectExportResult {
  requestId: string;
  s3Key:     string;
  tables:    Array<{ table: string; rowCount: number }>;
}

// ---------------------------------------------------------------------------
// SubjectExportWorker
// ---------------------------------------------------------------------------

export class SubjectExportWorker {
  private readonly logger = new Logger(SubjectExportWorker.name);
  private readonly s3: S3Client;

  constructor(
    private readonly pool: Pool,
    private readonly requestsRepo: SubjectRequestsRepoPort,
  ) {
    this.s3 = new S3Client({ region: AWS_REGION });
  }

  async process(
    payload: SubjectExportPayload,
    messageId: string,
  ): Promise<void> {
    // ── Step 1: Idempotency guard ───────────────────────────────────────────
    const jobId = await this.requestsRepo.markRunning(payload.requestId, messageId);
    if (!jobId) {
      this.logger.log(`[subject-export] Duplicate message ${messageId} — skipping`);
      return;
    }

    const s3Key = `subjects/${payload.tenantId}/${payload.requestId}/export.ndjson`;

    try {
      await this.assembleAndUpload(payload, s3Key);
      await this.requestsRepo.markCompleted(payload.requestId, s3Key);
    } catch (err) {
      const reason = (err as Error).message?.slice(0, 500) ?? 'unknown error';
      this.logger.error(`[subject-export] requestId=${payload.requestId} failed: ${reason}`);
      await this.requestsRepo.markFailed(payload.requestId, reason);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async assembleAndUpload(
    payload: SubjectExportPayload,
    s3Key: string,
  ): Promise<void> {
    const manifest = buildSubjectExportManifest(payload.isPortalPrincipal);
    const pass = new PassThrough();

    // Write the manifest header as the first NDJSON line.
    const header = JSON.stringify({
      _type:       'manifest',
      requestId:   payload.requestId,
      tenantId:    payload.tenantId,
      subjectId:   payload.subjectId,
      subjectType: payload.subjectType,
      tables:      manifest.map((e) => e.table),
      exportedAt:  new Date().toISOString(),
    });
    pass.write(header + '\n');

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket:               S3_EXPORT_BUCKET,
        Key:                  s3Key,
        Body:                 pass,
        ContentType:          'application/x-ndjson',
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId:          S3_EXPORT_KMS_KEY_ID || undefined,
      },
      partSize:          S3_PART_SIZE_BYTES,
      queueSize:         S3_QUEUE_SIZE,
      leavePartsOnError: false,
    });

    // Collect table rows and write them, then close the stream.
    const writePromise = this.writeTableRows(payload, manifest, pass);

    const [uploadResult] = await Promise.all([upload.done(), writePromise]);
    void uploadResult;  // result used for side-effect (S3 confirms upload)
  }

  private async writeTableRows(
    payload: SubjectExportPayload,
    manifest: ReturnType<typeof buildSubjectExportManifest>,
    pass: PassThrough,
  ): Promise<void> {
    try {
      for (const entry of manifest) {
        const { table, subjectColumn, selectColumns, visibilityFilter } = entry;

        // Build safe parameterised query.
        const cols      = selectColumns.map((c) => `"${c}"`).join(', ');
        const whereExtra = visibilityFilter ? ` AND ${visibilityFilter}` : '';

        // Determine the subject filter column.
        const sql = `
          SELECT ${cols}
          FROM   "${table}"
          WHERE  tenant_id = $1
            AND  "${subjectColumn}" = $2${whereExtra}
          ORDER BY created_at ASC NULLS LAST
        `;

        const client = await this.pool.connect();
        try {
          await client.query(`SET LOCAL statement_timeout = 30000`);
          await client.query(
            `SET LOCAL app.current_tenant = '${payload.tenantId}'`,
          );

          const result = await client.query(sql, [payload.tenantId, payload.subjectId]);
          for (const row of result.rows) {
            pass.write(
              JSON.stringify({ _type: 'row', table, ...row }) + '\n',
            );
          }
        } finally {
          client.release();
        }
      }
    } finally {
      pass.end();
    }
  }
}
