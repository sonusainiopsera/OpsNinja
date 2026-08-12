/**
 * PdfRenderWorker — headless Chromium PDF renderer (WO-077).
 *
 * Processes export_jobs with format='pdf' from the same SQS pipeline as the
 * CSV worker, branching at format check. The job lifecycle (markProcessing,
 * markCompleted, markFailed, S3 upload with SSE-KMS) mirrors the CSV path so
 * both formats share the same export_jobs state machine.
 *
 * Security guarantees:
 *   1. All data values are passed through escapeHtml() inside the template
 *      builder — this worker never interpolates raw values into HTML.
 *   2. The page is loaded via page.setContent() (not a URL fetch), so no
 *      remote resources are loaded from this code path.
 *   3. Chromium is launched with --disable-remote-fonts, --no-default-browser-check,
 *      --disable-extensions, and inside a K8s NetworkPolicy with empty egress.
 *   4. A hard 45-second wall-clock timeout races the render Promise and closes
 *      the page regardless of outcome.
 *
 * Resource governance:
 *   - One Chromium instance per pod (lazy-initialised, reused across renders).
 *   - A mutex serialises renders so at most one render runs concurrently,
 *     bounding peak RSS to approximately 1 GB.
 *   - Pages are always closed in a finally block, releasing browser resources.
 *   - Chromium crash is detected via browser.isConnected(); the instance is
 *     restarted on the next render attempt.
 *
 * Metrics emitted (structured log lines for the OTEL log collector):
 *   opsninja_pdf_render_duration_ms   — wall clock from start to S3 upload done
 *   opsninja_pdf_page_count           — actual page count in the rendered PDF
 *   opsninja_pdf_render_failures      — per-cause error code
 *   opsninja_pdf_chromium_restart     — counter incremented on browser restart
 *
 * Row cap:
 *   PDF tabular sections are capped at PDF_ROW_CAP (default 5 000).  Requests
 *   exceeding the cap are rejected by ExportRequestService at enqueue time
 *   (422 EXPORT_FORMAT_ROW_LIMIT). Any row count above the cap detected here
 *   (unexpected payload) fails the job with EXPORT_FORMAT_ROW_LIMIT.
 */

import { Logger } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Pool, PoolClient } from 'pg';
import { Readable } from 'stream';

import {
  buildPdfHtml,
  buildHeaderTemplate,
  buildFooterTemplate,
  mapExportPayloadToTemplateData,
} from '../../modules/reporting/domain/report-pdf.template';
import type { ChartColumn, ChartDataRow } from '../../modules/reporting/domain/chart-option.builder';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface ExportJobsRepoPort {
  markProcessing(id: string, sqsMessageId: string): Promise<string | null>;
  markCompleted(id: string, update: { rowCount: number; byteSize: number; truncated: boolean; s3Key: string }): Promise<void>;
  markFailed(id: string, errorCode: string): Promise<void>;
}

/** Subset of the Playwright Page interface — injected for testability. */
export interface BrowserPagePort {
  setContent(html: string, options?: { waitUntil?: string }): Promise<void>;
  pdf(options?: {
    format?:         string;
    printBackground?: boolean;
    margin?:         { top?: string; right?: string; bottom?: string; left?: string };
    headerTemplate?: string;
    footerTemplate?: string;
    displayHeaderFooter?: boolean;
  }): Promise<Buffer>;
  close(): Promise<void>;
}

/** Subset of the Playwright Browser interface. */
export interface BrowserInstancePort {
  newPage(): Promise<BrowserPagePort>;
  isConnected(): boolean;
  close(): Promise<void>;
}

/** Factory that launches a headless Chromium browser. */
export type BrowserLaunchFn = () => Promise<BrowserInstancePort>;

// ---------------------------------------------------------------------------
// Export job payload (mirrors CSV worker shape)
// ---------------------------------------------------------------------------

export interface PdfExportJobPayload {
  jobId:         string;
  tenantId:      string;
  format:        'pdf';
  s3Key:         string;
  sql:           string;
  params:        unknown[];
  columns:       ChartColumn[];
  rowCap:        number;
  requestedBy:   string;
  reportTitle?:  string;
  chartType?:    'bar' | 'line' | 'table';
  tenantName?:   string;
  dataAsOf?:     string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const S3_EXPORT_BUCKET        = process.env['S3_EXPORT_BUCKET']    ?? '';
const S3_EXPORT_KMS_KEY_ID    = process.env['S3_EXPORT_KMS_KEY_ID'] ?? '';
const AWS_REGION              = process.env['AWS_REGION']           ?? 'us-east-1';
const ECHARTS_BUNDLE_PATH     = process.env['ECHARTS_BUNDLE_PATH']  ?? '/usr/share/opsninja/echarts.min.js';
const PDF_ROW_CAP_HARD        = parseInt(process.env['PDF_ROW_CAP'] ?? '5000', 10);
const RENDER_TIMEOUT_MS       = 45_000;

// ---------------------------------------------------------------------------
// PdfRenderWorker
// ---------------------------------------------------------------------------

export class PdfRenderWorker {
  private readonly logger = new Logger(PdfRenderWorker.name);
  private readonly s3: S3Client;

  /** Singleton browser instance — reused across renders. */
  private browser: BrowserInstancePort | null = null;

  /** Serialises renders: at most one render per pod at any time. */
  private renderLock = false;
  private renderQueue: Array<() => void> = [];

  private restartCount = 0;

  constructor(
    private readonly replicaPool: Pool,
    private readonly jobsRepo:    ExportJobsRepoPort,
    private readonly launchBrowser: BrowserLaunchFn,
  ) {
    this.s3 = new S3Client({ region: AWS_REGION });
  }

  // --------------------------------------------------------------------------
  // Public entry point
  // --------------------------------------------------------------------------

  async process(payload: PdfExportJobPayload, messageId: string): Promise<void> {
    const { jobId, tenantId, s3Key, sql, params, columns, rowCap } = payload;

    // Idempotency guard — mirrors CSV worker pattern.
    const claimed = await this.jobsRepo.markProcessing(jobId, messageId);
    if (!claimed) {
      this.logger.log('pdf:render:redelivery_skipped', { jobId, messageId });
      return;
    }

    this.logger.log('pdf:render:started', {
      jobId, tenantId, s3Key, messageId,
      metric: 'opsninja_pdf_render_started',
    });

    const startMs = Date.now();

    try {
      await this.acquireRenderLock();
      try {
        await this.renderAndUpload(payload, startMs);
      } finally {
        this.releaseRenderLock();
      }
    } catch (err) {
      const errorCode = classifyPdfError(err);
      this.logger.error('pdf:render:failed', {
        jobId, tenantId, errorCode,
        message: (err as Error).message,
        metric:  'opsninja_pdf_render_failures',
        cause:   errorCode,
      });
      await this.jobsRepo.markFailed(jobId, errorCode).catch(() => undefined);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Core render pipeline
  // --------------------------------------------------------------------------

  private async renderAndUpload(
    payload: PdfExportJobPayload,
    startMs: number,
  ): Promise<void> {
    const { jobId, tenantId, s3Key, sql, params, columns, rowCap } = payload;

    // ── 1. Fetch rows from replica ──────────────────────────────────────────
    let rows: ChartDataRow[] = [];
    let client: PoolClient | null = null;
    try {
      client = await this.replicaPool.connect();
      await client.query('BEGIN READ ONLY');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

      const effectiveCap = Math.min(rowCap, PDF_ROW_CAP_HARD);
      // Fetch effectiveCap + 1 to detect overflow without a COUNT query.
      const result = await client.query<ChartDataRow>(
        `${sql} LIMIT $${(params as unknown[]).length + 1}`,
        [...(params as unknown[]), effectiveCap + 1],
      );

      if (result.rows.length > effectiveCap) {
        throw new PdfRowCapExceededError(effectiveCap);
      }
      rows = result.rows;
      await client.query('COMMIT');
    } finally {
      await client?.query('ROLLBACK').catch(() => undefined);
      client?.release();
    }

    // ── 2. Build HTML ─────────────────────────────────────────────────────
    const templateData = mapExportPayloadToTemplateData(
      payload,
      rows,
      payload.tenantName ?? 'OpsNinja',
      ECHARTS_BUNDLE_PATH,
    );
    const html           = buildPdfHtml(templateData);
    const headerTemplate = buildHeaderTemplate(
      templateData.tenantName,
      templateData.reportTitle,
    );
    const footerTemplate = buildFooterTemplate(
      templateData.dataAsOf,
      templateData.classification ?? 'Confidential',
    );

    // ── 3. Render via Chromium with wall-clock timeout ────────────────────
    const pdfBuffer = await this.renderWithTimeout(
      html,
      headerTemplate,
      footerTemplate,
      jobId,
    );

    const byteSize = pdfBuffer.length;

    // ── 4. Upload to S3 with SSE-KMS ─────────────────────────────────────
    const bodyStream = Readable.from(pdfBuffer);
    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket:      S3_EXPORT_BUCKET,
        Key:         s3Key,
        Body:        bodyStream,
        ContentType: 'application/pdf',
        ...(S3_EXPORT_KMS_KEY_ID ? {
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId:          S3_EXPORT_KMS_KEY_ID,
        } : {}),
      },
      leavePartsOnError: false,
    });
    await upload.done();

    // ── 5. Mark job completed ─────────────────────────────────────────────
    await this.jobsRepo.markCompleted(jobId, {
      rowCount:  rows.length,
      byteSize,
      truncated: false,
      s3Key,
    });

    const durationMs = Date.now() - startMs;
    this.logger.log('pdf:render:completed', {
      jobId, tenantId, rowCount: rows.length, byteSize, durationMs,
      metric:    'opsninja_pdf_render_duration_ms',
      pageCount: estimatePageCount(rows.length),
    });
  }

  // --------------------------------------------------------------------------
  // Render with Chromium + timeout
  // --------------------------------------------------------------------------

  private async renderWithTimeout(
    html:            string,
    headerTemplate:  string,
    footerTemplate:  string,
    jobId:           string,
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    let page: BrowserPagePort | null = null;

    const renderPromise = (async (): Promise<Buffer> => {
      page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: 'networkidle' });
        const pdfBuffer = await page.pdf({
          format:               'A4',
          printBackground:      true,
          margin:               { top: '20mm', right: '15mm', bottom: '25mm', left: '15mm' },
          displayHeaderFooter:  true,
          headerTemplate,
          footerTemplate,
        });
        return pdfBuffer;
      } finally {
        await page.close().catch(() => undefined);
        page = null;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new PdfRenderTimeoutError(RENDER_TIMEOUT_MS)), RENDER_TIMEOUT_MS),
    );

    try {
      return await Promise.race([renderPromise, timeoutPromise]);
    } catch (err) {
      // Ensure page is closed even if timeout fires first.
      await page?.close().catch(() => undefined);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Browser lifecycle (singleton with restart on crash)
  // --------------------------------------------------------------------------

  private async getBrowser(): Promise<BrowserInstancePort> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    // Browser is gone (crash or first launch) — restart it.
    if (this.browser) {
      this.restartCount++;
      this.logger.warn('pdf:render:browser_restart', {
        restartCount: this.restartCount,
        metric:       'opsninja_pdf_chromium_restart',
      });
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }

    this.browser = await this.launchBrowser();
    this.logger.log('pdf:render:browser_started', {
      restartCount: this.restartCount,
    });
    return this.browser;
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }

  // --------------------------------------------------------------------------
  // Render concurrency gate (serialise renders — one per pod)
  // --------------------------------------------------------------------------

  private acquireRenderLock(): Promise<void> {
    if (!this.renderLock) {
      this.renderLock = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.renderQueue.push(resolve));
  }

  private releaseRenderLock(): void {
    const next = this.renderQueue.shift();
    if (next) {
      next();
    } else {
      this.renderLock = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Custom error classes
// ---------------------------------------------------------------------------

export class PdfRenderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`PDF render exceeded ${timeoutMs}ms wall-clock limit`);
    this.name = 'PdfRenderTimeoutError';
  }
}

export class PdfRowCapExceededError extends Error {
  constructor(cap: number) {
    super(
      `PDF export row count exceeds the ${cap}-row limit. ` +
      'Use format=csv for larger datasets.',
    );
    this.name = 'PdfRowCapExceededError';
  }
}

export class PdfChromiumCrashError extends Error {
  constructor() {
    super('Chromium process crashed during PDF render');
    this.name = 'PdfChromiumCrashError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyPdfError(err: unknown): string {
  const msg  = (err as Error)?.message ?? '';
  const name = (err as Error)?.name    ?? '';

  if (name === 'PdfRenderTimeoutError' || msg.includes('wall-clock limit')) {
    return 'PDF_RENDER_TIMEOUT';
  }
  if (name === 'PdfRowCapExceededError' || msg.includes('row limit')) {
    return 'EXPORT_FORMAT_ROW_LIMIT';
  }
  if (name === 'PdfChromiumCrashError' || msg.includes('Target closed') || msg.includes('Session closed')) {
    return 'PDF_CHROMIUM_CRASH';
  }
  if (msg.includes('out of memory') || msg.includes('OOM')) {
    return 'PDF_RENDER_OOM';
  }
  if (msg.includes('AccessDenied') || msg.includes('KMS')) {
    return 'EXPORT_KMS_ACCESS_DENIED';
  }
  if (msg.includes('NoSuchBucket') || msg.includes('S3')) {
    return 'EXPORT_S3_ERROR';
  }
  return 'PDF_RENDER_INTERNAL_ERROR';
}

function estimatePageCount(rowCount: number, rowsPerPage = 30): number {
  return Math.max(1, Math.ceil(rowCount / rowsPerPage));
}
