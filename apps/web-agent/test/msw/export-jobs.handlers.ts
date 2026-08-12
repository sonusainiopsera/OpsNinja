/**
 * MSW handlers — Export Jobs lifecycle (WO-079 AC-13).
 *
 * Stages every job state the client must handle:
 *   queued      — initial state after POST
 *   processing  — intermediate polling state
 *   completed   — with a fresh presigned downloadUrl
 *   failed      — with each supported error code
 *   expired     — GET returns 410 EXPORT_EXPIRED
 *
 * Usage in tests:
 *   import { server } from '../setup'   // or however MSW server is exported
 *   import { exportJobHandlers, overrideJobState } from '../msw/export-jobs.handlers'
 *   server.use(...exportJobHandlers)
 *   // To advance a specific job to a new state:
 *   server.use(overrideJobState('job-001', COMPLETED_JOB))
 */

import { http, HttpResponse } from 'msw';
import type { ExportJob, CreateExportResponse } from '../../lib/api/reporting/types';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const NOW = '2026-08-12T10:00:00.000Z';
const EXPIRES_AT = '2026-08-19T10:00:00.000Z'; // 7 days later

// ---------------------------------------------------------------------------
// Fixture job objects
// ---------------------------------------------------------------------------

export const QUEUED_JOB: ExportJob = {
  id: 'job-queued-001',
  format: 'csv',
  status: 'queued',
  createdAt: NOW,
  expiresAt: EXPIRES_AT,
  definition: { metrics: ['ticket_count'], groupBy: ['priority'], filterAst: null },
};

export const PROCESSING_JOB: ExportJob = {
  id: 'job-processing-001',
  format: 'csv',
  status: 'processing',
  createdAt: NOW,
  expiresAt: EXPIRES_AT,
  definition: { metrics: ['ticket_count'], groupBy: ['priority'], filterAst: null },
};

export const COMPLETED_JOB: ExportJob = {
  id: 'job-completed-001',
  format: 'csv',
  status: 'completed',
  rowCount: 1842,
  fileSizeBytes: 94208,   // ~92 KB
  createdAt: NOW,
  expiresAt: EXPIRES_AT,
  // NOTE: downloadUrl is intentionally provided by the server here.
  // The client must NOT cache this — useDownloadExport fetches it fresh on every click.
  downloadUrl: 'https://s3.example.com/exports/job-completed-001.csv?X-Amz-Expires=900&X-Amz-Signature=abc',
  definition: { metrics: ['ticket_count'], groupBy: ['priority'], filterAst: null },
};

export const COMPLETED_PDF_JOB: ExportJob = {
  id: 'job-completed-pdf-001',
  format: 'pdf',
  status: 'completed',
  rowCount: 500,
  fileSizeBytes: 2097152, // 2 MB
  createdAt: NOW,
  expiresAt: EXPIRES_AT,
  downloadUrl: 'https://s3.example.com/exports/job-completed-pdf-001.pdf?X-Amz-Expires=900&X-Amz-Signature=def',
  definition: { metrics: ['sla_attainment_pct'], groupBy: ['organization'], filterAst: null },
};

export const FAILED_QUERY_TIMEOUT_JOB: ExportJob = {
  id: 'job-failed-timeout-001',
  format: 'csv',
  status: 'failed',
  createdAt: NOW,
  errorCode: 'EXPORT_QUERY_TIMEOUT',
  traceId: 'trace-qt-abc123',
  definition: { metrics: ['ticket_count'], groupBy: ['priority'], filterAst: null },
};

export const FAILED_ROW_LIMIT_JOB: ExportJob = {
  id: 'job-failed-rowlimit-001',
  format: 'csv',
  status: 'failed',
  createdAt: NOW,
  errorCode: 'EXPORT_ROW_LIMIT_EXCEEDED',
  traceId: 'trace-rl-def456',
  definition: { metrics: ['ticket_count'], groupBy: ['priority'], filterAst: null },
};

export const FAILED_RENDER_TIMEOUT_JOB: ExportJob = {
  id: 'job-failed-render-001',
  format: 'pdf',
  status: 'failed',
  createdAt: NOW,
  errorCode: 'EXPORT_RENDER_TIMEOUT',
  traceId: 'trace-rt-ghi789',
  definition: { metrics: ['sla_attainment_pct'], groupBy: ['organization'], filterAst: null },
};

export const EXPIRED_JOB: ExportJob = {
  id: 'job-expired-001',
  format: 'csv',
  status: 'expired',
  rowCount: 3200,
  fileSizeBytes: 158720,
  createdAt: '2026-08-05T10:00:00.000Z', // created 7 days ago
  expiresAt: '2026-08-12T09:59:00.000Z', // expired ~1 minute ago
  definition: { metrics: ['ticket_count', 'sla_attainment_pct'], groupBy: ['priority'], filterAst: null },
};

/** A job stuck in processing beyond the 10-minute ceiling. */
export const STUCK_JOB: ExportJob = {
  id: 'job-stuck-001',
  format: 'pdf',
  status: 'processing',
  createdAt: '2026-08-12T09:40:00.000Z', // 20 minutes ago
  expiresAt: EXPIRES_AT,
  traceId: 'trace-stuck-xyz999',
  definition: { metrics: ['ticket_count'], groupBy: [], filterAst: null },
};

// ---------------------------------------------------------------------------
// Map used for stateful job simulation in tests
// ---------------------------------------------------------------------------

const JOB_STORE: Map<string, ExportJob> = new Map([
  [QUEUED_JOB.id, QUEUED_JOB],
  [PROCESSING_JOB.id, PROCESSING_JOB],
  [COMPLETED_JOB.id, COMPLETED_JOB],
  [COMPLETED_PDF_JOB.id, COMPLETED_PDF_JOB],
  [FAILED_QUERY_TIMEOUT_JOB.id, FAILED_QUERY_TIMEOUT_JOB],
  [FAILED_ROW_LIMIT_JOB.id, FAILED_ROW_LIMIT_JOB],
  [FAILED_RENDER_TIMEOUT_JOB.id, FAILED_RENDER_TIMEOUT_JOB],
  [EXPIRED_JOB.id, EXPIRED_JOB],
  [STUCK_JOB.id, STUCK_JOB],
]);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** POST /api/v1/exports — create a new export job, returns 202 queued */
const createExportHandler = http.post('/api/v1/exports', async ({ request }) => {
  const body = (await request.json()) as { format?: string };
  const format = body?.format === 'pdf' ? 'pdf' : 'csv';
  const jobId = `job-${Date.now()}`;
  const newJob: ExportJob = {
    id: jobId,
    format,
    status: 'queued',
    createdAt: NOW,
    expiresAt: EXPIRES_AT,
    definition: { metrics: [], groupBy: [], filterAst: null },
  };
  JOB_STORE.set(jobId, newJob);
  const response: CreateExportResponse = {
    jobId,
    status: 'queued',
    pollUrl: `/api/v1/exports/${jobId}`,
  };
  return HttpResponse.json(response, { status: 202 });
});

/** GET /api/v1/exports/:id — poll a specific job */
const getExportJobHandler = http.get('/api/v1/exports/:id', ({ params }) => {
  const id = params['id'] as string;
  const job = JOB_STORE.get(id);

  if (!job) {
    return HttpResponse.json(
      { error: { code: 'EXPORT_NOT_FOUND', message: 'Export job not found' } },
      { status: 404 },
    );
  }

  // Expired jobs return 410
  if (job.status === 'expired') {
    return HttpResponse.json(
      {
        error: {
          code: 'EXPORT_EXPIRED',
          message: 'This export has expired and the artifact has been deleted.',
          traceId: job.traceId ?? null,
        },
      },
      { status: 410 },
    );
  }

  return HttpResponse.json(job);
});

/** GET /api/v1/exports — list all tracked jobs (newest first) */
const listExportJobsHandler = http.get('/api/v1/exports', () => {
  const jobs = Array.from(JOB_STORE.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return HttpResponse.json({ data: jobs });
});

/** POST /api/v1/schedules — create a recurring schedule */
const createScheduleHandler = http.post('/api/v1/schedules', async ({ request }) => {
  const body = (await request.json()) as Record<string, unknown>;
  // Validate required fields — return 422 for known test error codes
  const recipients = (body?.recipients as string[]) ?? [];
  if (recipients.some((r) => r.endsWith('@blocked.example.com'))) {
    return HttpResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: [
            {
              code: 'RECIPIENT_DOMAIN_NOT_ALLOWED',
              field: 'recipients',
              message: 'One or more recipient domains are not allowed for this tenant.',
            },
          ],
        },
      },
      { status: 422 },
    );
  }
  // Cron expression with sub-hourly interval (e.g. "* * * * *" = every minute)
  const cron = body?.cronExpression as string | undefined;
  if (cron === '* * * * *') {
    return HttpResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: [
            {
              code: 'SCHEDULE_INTERVAL_TOO_SHORT',
              field: 'cadence',
              message: 'Schedule interval is too short — minimum is 1 hour.',
            },
          ],
        },
      },
      { status: 422 },
    );
  }
  return HttpResponse.json(
    { scheduleId: `sched-${Date.now()}`, status: 'active' },
    { status: 201 },
  );
});

/** All export-jobs MSW handlers, suitable for server.use(...exportJobHandlers) */
export const exportJobHandlers = [
  createExportHandler,
  getExportJobHandler,
  listExportJobsHandler,
  createScheduleHandler,
];

// ---------------------------------------------------------------------------
// Test helper — override a specific job's state for lifecycle progression
// ---------------------------------------------------------------------------

/**
 * Returns an MSW handler override that serves a specific job fixture for GET /api/v1/exports/:id.
 * Use with server.use(overrideJobState('job-001', COMPLETED_JOB)) to advance lifecycle.
 */
export function overrideJobState(jobId: string, job: ExportJob) {
  JOB_STORE.set(jobId, job);
  return http.get(`/api/v1/exports/${jobId}`, () => {
    if (job.status === 'expired') {
      return HttpResponse.json(
        { error: { code: 'EXPORT_EXPIRED', message: 'Export has expired.' } },
        { status: 410 },
      );
    }
    return HttpResponse.json(job);
  });
}

/**
 * Reset the job store to the initial fixture state.
 * Call in beforeEach to ensure test isolation.
 */
export function resetJobStore() {
  JOB_STORE.clear();
  JOB_STORE.set(QUEUED_JOB.id, QUEUED_JOB);
  JOB_STORE.set(PROCESSING_JOB.id, PROCESSING_JOB);
  JOB_STORE.set(COMPLETED_JOB.id, COMPLETED_JOB);
  JOB_STORE.set(COMPLETED_PDF_JOB.id, COMPLETED_PDF_JOB);
  JOB_STORE.set(FAILED_QUERY_TIMEOUT_JOB.id, FAILED_QUERY_TIMEOUT_JOB);
  JOB_STORE.set(FAILED_ROW_LIMIT_JOB.id, FAILED_ROW_LIMIT_JOB);
  JOB_STORE.set(FAILED_RENDER_TIMEOUT_JOB.id, FAILED_RENDER_TIMEOUT_JOB);
  JOB_STORE.set(EXPIRED_JOB.id, EXPIRED_JOB);
  JOB_STORE.set(STUCK_JOB.id, STUCK_JOB);
}
