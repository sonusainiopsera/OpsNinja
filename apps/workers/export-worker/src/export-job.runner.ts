/**
 * ExportJobRunner — shared lifecycle state machine for CSV and PDF export jobs (WO-077).
 *
 * Responsibilities:
 *   1. Claim a queued job (conditional UPDATE WHERE status='queued' → 'processing').
 *      Returns null on duplicate SQS delivery (idempotent no-op).
 *   2. Execute the renderer callback (csv or pdf) with a wall-clock timeout.
 *   3. Upload the result buffer to S3 with SSE-KMS.
 *   4. Transition the job to 'completed' or 'failed' with a structured error code.
 *   5. Classify failures as transient (retry) or permanent (fail immediately).
 *
 * Error codes:
 *   EXPORT_ROW_LIMIT_EXCEEDED  — permanent: too many rows for format
 *   PDF_RENDER_TIMEOUT         — transient: render exceeded 45-second wall clock
 *   PDF_RENDER_OOM             — transient: render exceeded memory limit
 *   PDF_CHROMIUM_CRASH         — transient: Chromium process died mid-render
 *   S3_UPLOAD_FAILED           — transient: S3 5xx / connection error
 *   REPLICA_UNAVAILABLE        — transient: reporting replica query failed
 *   TEMPLATE_CONTRACT_VIOLATED — permanent: template contract mismatch
 *   UNKNOWN                    — transient: catch-all; retried
 *
 * Retry budget:
 *   - Transient: up to 6 attempts with exponential backoff up to 900s.
 *   - Permanent: immediate DLQ routing, no retry.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Pool } from 'pg';

/** Structured outbox payload from export_job.queued event */
export interface ExportJobPayload {
  jobId:       string;
  tenantId:    string;
  format:      'csv' | 'pdf';
  s3Key:       string;
  sql:         string;
  params:      unknown[];
  columns:     Array<{ key: string; label: string }>;
  rowCap:      number;
  requestedBy: string;
  reportTitle?: string;
  chartType?:   string;
  tenantName?:  string;
  dataAsOf?:    string;
}

export interface RendererResult {
  buffer:   Buffer;
  rowCount: number;
  pageCount?: number;
  truncated: boolean;
}

/** Classify whether an error should trigger a retry or go straight to DLQ. */
export type FailureClass = 'transient' | 'permanent';

export interface ExportError {
  code:    string;
  message: string;
  class:   FailureClass;
}

const PERMANENT_CODES = new Set([
  'EXPORT_ROW_LIMIT_EXCEEDED',
  'TEMPLATE_CONTRACT_VIOLATED',
  'EXPORT_FORMAT_ROW_LIMIT',
]);

export function classifyError(err: unknown): ExportError {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    (err as { code?: string }).code ??
    (message.includes('timeout')  ? 'PDF_RENDER_TIMEOUT'  :
     message.includes('OOM')      ? 'PDF_RENDER_OOM'      :
     message.includes('Protocol') ? 'PDF_CHROMIUM_CRASH'  :
     message.includes('S3')       ? 'S3_UPLOAD_FAILED'    :
     message.includes('replica')  ? 'REPLICA_UNAVAILABLE' : 'UNKNOWN');

  return {
    code,
    message: message.slice(0, 500), // never surface full stack in error_code
    class: PERMANENT_CODES.has(code) ? 'permanent' : 'transient',
  };
}

const RENDER_TIMEOUT_MS = parseInt(
  process.env['PDF_RENDER_TIMEOUT_MS'] ?? '45000',
  10,
);

/**
 * Wrap a renderer promise with a hard wall-clock timeout.
 * If the timeout fires, throws an error with code=PDF_RENDER_TIMEOUT.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms = RENDER_TIMEOUT_MS,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        const err = new Error(`Render exceeded ${ms}ms wall-clock limit`);
        (err as { code?: string }).code = 'PDF_RENDER_TIMEOUT';
        reject(err);
      }, ms),
    ),
  ]);
}

/** Upload a buffer to S3 with SSE-KMS. */
export async function uploadToS3(
  s3:      S3Client,
  bucket:  string,
  key:     string,
  buffer:  Buffer,
  contentType: string,
): Promise<void> {
  const kmsKeyId = process.env['S3_EXPORT_KMS_KEY_ID'];
  await s3.send(
    new PutObjectCommand({
      Bucket:               bucket,
      Key:                  key,
      Body:                 buffer,
      ContentType:          contentType,
      ServerSideEncryption: kmsKeyId ? 'aws:kms' : undefined,
      SSEKMSKeyId:          kmsKeyId,
    }),
  );
}

/** Content-type by format */
export function contentTypeFor(format: 'csv' | 'pdf'): string {
  return format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8';
}

/**
 * Mark a job as processing in the DB using a conditional UPDATE.
 * Returns true if the claim succeeded (first delivery), false on duplicate.
 */
export async function claimJob(
  pool: Pool,
  jobId: string,
  sqsMessageId: string,
): Promise<boolean> {
  const result = await pool.query<{ id: string }>(
    `UPDATE export_jobs
        SET status = 'processing', error_code = $2, updated_at = now()
      WHERE id = $1 AND status = 'queued'
      RETURNING id`,
    [jobId, sqsMessageId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Mark a job as completed with row/byte counts. */
export async function markJobCompleted(
  pool: Pool,
  jobId:     string,
  s3Key:     string,
  rowCount:  number,
  byteSize:  number,
  truncated: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE export_jobs
        SET status       = 'completed',
            s3_key       = $2,
            row_count    = $3,
            byte_size    = $4,
            truncated    = $5,
            error_code   = NULL,
            completed_at = now()
      WHERE id = $1`,
    [jobId, s3Key, rowCount, byteSize, truncated],
  );
}

/** Mark a job as failed with a classified error code. */
export async function markJobFailed(
  pool:      Pool,
  jobId:     string,
  errorCode: string,
): Promise<void> {
  await pool.query(
    `UPDATE export_jobs
        SET status       = 'failed',
            error_code   = $2,
            completed_at = now()
      WHERE id = $1`,
    [jobId, errorCode],
  );
}

/**
 * Execute the full export lifecycle for one job.
 *
 * @param pool        - Postgres connection pool
 * @param s3          - S3 client
 * @param bucket      - Target S3 bucket
 * @param payload     - Decoded outbox event payload
 * @param sqsMessageId - SQS message id (used as idempotency key in claim)
 * @param renderer    - Format-specific render callback
 */
export async function runExportJob(
  pool:         Pool,
  s3:           S3Client,
  bucket:       string,
  payload:      ExportJobPayload,
  sqsMessageId: string,
  renderer:     (payload: ExportJobPayload) => Promise<RendererResult>,
): Promise<void> {
  const { jobId, s3Key, format } = payload;

  // 1. Claim — idempotency gate.
  const claimed = await claimJob(pool, jobId, sqsMessageId);
  if (!claimed) {
    console.log(JSON.stringify({ msg: 'export:duplicate_delivery', jobId, sqsMessageId }));
    return;
  }

  let result: RendererResult;
  try {
    // 2. Render (with hard wall-clock timeout).
    result = await withTimeout(renderer(payload));
  } catch (err) {
    const classified = classifyError(err);
    console.error(JSON.stringify({
      msg:     'export:render_failed',
      jobId,
      format,
      code:    classified.code,
      class:   classified.class,
      message: classified.message,
    }));
    await markJobFailed(pool, jobId, classified.code);
    // Re-throw transient errors so SQS requeues; swallow permanent errors.
    if (classified.class === 'transient') throw err;
    return;
  }

  try {
    // 3. Upload to S3 with SSE-KMS.
    await uploadToS3(s3, bucket, s3Key, result.buffer, contentTypeFor(format));
  } catch (err) {
    const classified = classifyError(err);
    console.error(JSON.stringify({
      msg: 'export:s3_upload_failed', jobId, code: classified.code,
    }));
    await markJobFailed(pool, jobId, classified.code);
    throw err; // always retryable
  }

  // 4. Mark completed.
  await markJobCompleted(
    pool, jobId, s3Key,
    result.rowCount, result.buffer.length, result.truncated,
  );

  console.log(JSON.stringify({
    msg:       'export:completed',
    jobId,
    format,
    rowCount:  result.rowCount,
    byteSize:  result.buffer.length,
    truncated: result.truncated,
    pageCount: result.pageCount,
  }));
}
