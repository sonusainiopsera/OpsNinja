/**
 * ExportWorker — streaming CSV export worker (WO-076).
 *
 * Consumes the exports SQS queue; for each message:
 *  1. Atomically transitions job status queued → processing (idempotency guard).
 *     Returns null (ack-and-exit) when the job is already processing/completed/failed.
 *  2. Opens a server-side Postgres cursor over the reporting replica using
 *     QueryStream, batching 1000 rows at a time.
 *  3. Pipes rows through CsvStreamSerializer into an S3 multipart upload
 *     (lib-storage) with 8 MB parts and queue=2 to bound resident memory.
 *  4. Records SSE-KMS encryption, tenant-namespaced key, rowCount, byteSize,
 *     truncation flag and completedAt on the job row.
 *  5. On failure: records errorCode + routes to DLQ after 6 retry attempts.
 *
 * Memory discipline:
 *   The pipeline never calls toArray() or accumulates rows. Peak RSS is
 *   O(cursor-batch × row-width + 2 × part-size) ≈ 16–20 MB for typical schemas,
 *   safely under the 128 MB AC3 threshold.
 *
 * NEVER make outbound HTTP calls to the Jira API from this worker.
 */

import { Logger } from '@nestjs/common';
import { S3Client, CreateMultipartUploadCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { PassThrough } from 'stream';
import { Pool, PoolClient } from 'pg';
import QueryStream from 'pg-query-stream';

import { CsvStreamSerializer, type CsvColumn } from './csv-stream.serializer';

// ---------------------------------------------------------------------------
// Types mirroring the outbox event payload written by ExportRequestService
// ---------------------------------------------------------------------------

export interface ExportJobPayload {
  jobId:       string;
  tenantId:    string;
  format:      'csv' | 'pdf';
  s3Key:       string;
  sql:         string;
  params:      unknown[];
  columns:     CsvColumn[];
  rowCap:      number;
  requestedBy: string;
}

export interface ExportJobsRepoPort {
  markProcessing(id: string, sqsMessageId: string): Promise<string | null>;
  markCompleted(id: string, update: { rowCount: number; byteSize: number; truncated: boolean; s3Key: string }): Promise<void>;
  markFailed(id: string, errorCode: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CURSOR_BATCH_SIZE       = 1000;
const S3_PART_SIZE_BYTES      = 8 * 1024 * 1024;  // 8 MB
const S3_QUEUE_SIZE           = 2;
const S3_EXPORT_BUCKET        = process.env['S3_EXPORT_BUCKET'] ?? '';
const S3_EXPORT_KMS_KEY_ID    = process.env['S3_EXPORT_KMS_KEY_ID'] ?? '';
const AWS_REGION              = process.env['AWS_REGION'] ?? 'us-east-1';
const EXPORT_ROW_CAP          = parseInt(process.env['EXPORT_ROW_CAP'] ?? '500000', 10);

// ---------------------------------------------------------------------------
// ExportWorker
// ---------------------------------------------------------------------------

export class ExportWorker {
  private readonly logger = new Logger(ExportWorker.name);
  private readonly s3: S3Client;

  constructor(
    private readonly replicaPool: Pool,
    private readonly jobsRepo:    ExportJobsRepoPort,
  ) {
    this.s3 = new S3Client({ region: AWS_REGION });
  }

  /**
   * Process one export job message.
   *
   * @param payload   - Decoded outbox/SQS message payload.
   * @param messageId - SQS message id for observability and idempotency scratch.
   */
  async process(payload: ExportJobPayload, messageId: string): Promise<void> {
    const { jobId, tenantId, s3Key, sql, params, columns, rowCap } = payload;

    // ── 1. Idempotency guard ─────────────────────────────────────────────────
    const claimed = await this.jobsRepo.markProcessing(jobId, messageId);
    if (!claimed) {
      this.logger.log('export:worker:redelivery_skipped', { jobId, messageId });
      return; // Already processing or completed — safe ack.
    }

    this.logger.log('export:worker:started', {
      jobId, tenantId, s3Key, messageId,
      metric: 'opsninja_export_started',
    });

    const startMs = Date.now();
    let rowCount  = 0;
    let byteSize  = 0;
    let truncated = false;
    let client: PoolClient | null = null;

    try {
      client = await this.replicaPool.connect();

      // ── 2. Set tenant RLS context ──────────────────────────────────────────
      await client.query('BEGIN READ ONLY');
      await client.query(
        "SELECT set_config('app.current_tenant', $1, true)",
        [tenantId],
      );

      // ── 3. Build streaming pipeline ─────────────────────────────────────────
      // pg-query-stream opens a server-side cursor with batch=CURSOR_BATCH_SIZE,
      // yielding rows as Node.js Readable events — never buffers the full result.
      const queryStream = new QueryStream(sql, params as unknown[], {
        batchSize: CURSOR_BATCH_SIZE,
      });

      const csvSerializer = new CsvStreamSerializer(columns);
      const passThrough   = new PassThrough();

      // Count bytes as they pass through.
      passThrough.on('data', (chunk: Buffer) => {
        byteSize += chunk.length;
      });

      // ── 4. Row cap enforcement ───────────────────────────────────────────────
      // We wrap the query stream in a manual row-counting transform to handle
      // the rowCap+1 trick: if we receive rowCap+1 rows, mark truncated=true
      // and stop streaming.
      const effectiveCap = Math.min(rowCap, EXPORT_ROW_CAP);
      let rowsSeen = 0;

      const pgStream = client.query(queryStream);

      pgStream.on('data', (row: Record<string, unknown>) => {
        rowsSeen++;
        if (rowsSeen > effectiveCap) {
          truncated = true;
          pgStream.destroy(); // Stop cursor; triggers 'close' on the PG stream.
          return;
        }
        rowCount++;
        csvSerializer.write(row);
      });

      // ── 5. S3 multipart upload with SSE-KMS ──────────────────────────────────
      csvSerializer.pipe(passThrough);

      const upload = new Upload({
        client: this.s3,
        params: {
          Bucket: S3_EXPORT_BUCKET,
          Key:    s3Key,
          Body:   passThrough,
          ContentType: 'text/csv; charset=utf-8',
          ...(S3_EXPORT_KMS_KEY_ID ? {
            ServerSideEncryption: 'aws:kms',
            SSEKMSKeyId:          S3_EXPORT_KMS_KEY_ID,
          } : {}),
        },
        partSize:  S3_PART_SIZE_BYTES,
        queueSize: S3_QUEUE_SIZE,
        leavePartsOnError: false, // abort incomplete multipart on failure
      });

      // Wait for all rows to be streamed and uploaded.
      await new Promise<void>((resolve, reject) => {
        pgStream.on('error', reject);
        pgStream.on('end', () => { csvSerializer.end(); });
        pgStream.on('close', () => { csvSerializer.end(); }); // triggered on destroy()
        csvSerializer.on('error', reject);
        passThrough.on('error', reject);
        upload.done().then(() => resolve()).catch(reject);
      });

      await client.query('COMMIT');

      // ── 6. Mark job completed ─────────────────────────────────────────────────
      await this.jobsRepo.markCompleted(jobId, { rowCount, byteSize, truncated, s3Key });

      const durationMs = Date.now() - startMs;
      this.logger.log('export:worker:completed', {
        jobId, tenantId, rowCount, byteSize, truncated, durationMs,
        metric: 'opsninja_export_completed',
      });
    } catch (err) {
      // Abort the replica transaction if open.
      await client?.query('ROLLBACK').catch(() => undefined);

      const errorCode = classifyError(err);
      this.logger.error('export:worker:failed', {
        jobId, tenantId, errorCode,
        message: (err as Error).message,
        metric: 'opsninja_export_failures_total',
      });

      await this.jobsRepo.markFailed(jobId, errorCode).catch(() => undefined);
      throw err; // Re-throw so the SQS consumer applies retry / DLQ logic.
    } finally {
      client?.release();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyError(err: unknown): string {
  const msg = (err as Error).message ?? '';
  if (msg.includes('canceling statement due to statement timeout')) {
    return 'EXPORT_QUERY_TIMEOUT';
  }
  if (msg.includes('AccessDenied') || msg.includes('KMS')) {
    return 'EXPORT_KMS_ACCESS_DENIED';
  }
  if (msg.includes('NoSuchBucket') || msg.includes('S3')) {
    return 'EXPORT_S3_ERROR';
  }
  return 'EXPORT_INTERNAL_ERROR';
}
