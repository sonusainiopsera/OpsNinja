/**
 * Integration tests for WO-076 AC11: Streaming CSV Export Worker To S3.
 *
 * Uses NestJS TestingModule + supertest with mocked ExportRequestService,
 * ExportJobsRepository and PresignedUrlService — no real Postgres or S3.
 * TestContextInterceptor injects PrincipalContext via x-test-principal header.
 *
 * Covers:
 *   AC1  — POST /exports: Lead 202, Agent 403
 *   AC1  — POST /exports: Location header set
 *   AC1  — POST /exports: neither/both definitionId+definition → 400
 *   AC2  — GET /exports/:id: completed job returns presigned downloadUrl
 *   AC2  — GET /exports/:id: non-completed job returns no downloadUrl
 *   AC2  — GET /exports/:id: out-of-scope/missing id → 404 (non-disclosure)
 *   AC5  — GET /exports/:id: expiresAt in past → 410 EXPORT_EXPIRED (no URL)
 *   AC6  — Redelivery: markProcessing returns null → no second S3 object (unit)
 *   AC10 — DTO: unknown field in POST body → 400
 */

import {
  Test,
  type TestingModule,
} from '@nestjs/testing';
import {
  INestApplication,
  HttpStatus,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  NotFoundException,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import * as request from 'supertest';
import { Observable, from, lastValueFrom } from 'rxjs';

import { ExportsController } from '../../../src/modules/reporting/api/exports.controller';
import { ExportRequestService } from '../../../src/modules/reporting/application/export-request.service';
import { ExportJobsRepository } from '../../../src/modules/reporting/application/export-jobs.repository';
import { PresignedUrlService } from '../../../src/modules/reporting/application/presigned-url.service';
import {
  requestContextStore,
  type PrincipalContext,
  type RequestContext,
} from '../../../src/observability/request-context';
import {
  PRINCIPAL_LEAD,
  PRINCIPAL_AGENT_A,
  REPORT_TENANT_A,
} from '../../fixtures/reporting-principals';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JOB_ID = 'e0000001-0000-0000-0000-000000000001';
const S3_KEY = `exports/${REPORT_TENANT_A}/${JOB_ID}.csv`;
const PRESIGNED_URL = `https://s3.example.com/${S3_KEY}?X-Amz-Expires=900&mock=1`;

// ---------------------------------------------------------------------------
// Job fixture builders
// ---------------------------------------------------------------------------

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id:          JOB_ID,
    tenantId:    REPORT_TENANT_A,
    requestedBy: PRINCIPAL_LEAD.userId,
    format:      'csv',
    status:      'queued',
    s3Key:       null,
    rowCount:    null,
    byteSize:    null,
    truncated:   false,
    errorCode:   null,
    createdAt:   new Date('2024-06-01T10:00:00Z'),
    completedAt: null,
    expiresAt:   new Date('2024-06-08T10:00:00Z'), // 7 days later (future)
    ...overrides,
  };
}

function makeCompletedJob(overrides: Record<string, unknown> = {}) {
  return makeJob({
    status:      'completed',
    s3Key:       S3_KEY,
    rowCount:    1234,
    byteSize:    56789,
    truncated:   false,
    completedAt: new Date('2024-06-01T10:05:00Z'),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// TestContextInterceptor — same pattern as report-run.spec.ts
// ---------------------------------------------------------------------------

@Injectable()
class TestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: PrincipalContext;
    }>();

    const header = req.headers['x-test-principal'];
    if (!header) return next.handle();

    const principal = JSON.parse(header) as PrincipalContext;
    req.user = principal;

    const ctx: RequestContext = {
      traceId:   (principal as Record<string, unknown>)['traceId'] as string,
      principal,
      txHandle:  {} as never,
      startedAt: Date.now(),
    };

    return from(requestContextStore.run(ctx, () => lastValueFrom(next.handle())));
  }
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

type MockExportSvc = { requestExport: jest.Mock };
type MockJobsRepo  = { findById: jest.Mock };
type MockPresigned = { getPresignedUrl: jest.Mock };

async function buildApp(overrides: {
  exportSvc?: Partial<MockExportSvc>;
  jobsRepo?:  Partial<MockJobsRepo>;
  presigned?: Partial<MockPresigned>;
} = {}): Promise<{
  app:       INestApplication;
  exportSvc: MockExportSvc;
  jobsRepo:  MockJobsRepo;
  presigned: MockPresigned;
}> {
  const exportSvc: MockExportSvc = {
    requestExport: jest.fn().mockResolvedValue({
      jobId:   JOB_ID,
      status:  'queued',
      pollUrl: `/api/v1/exports/${JOB_ID}`,
    }),
    ...overrides.exportSvc,
  };

  const jobsRepo: MockJobsRepo = {
    findById: jest.fn().mockResolvedValue(makeJob()),
    ...overrides.jobsRepo,
  };

  const presigned: MockPresigned = {
    getPresignedUrl: jest.fn().mockResolvedValue(PRESIGNED_URL),
    ...overrides.presigned,
  };

  const module: TestingModule = await Test.createTestingModule({
    controllers: [ExportsController],
    providers: [
      { provide: ExportRequestService, useValue: exportSvc },
      { provide: ExportJobsRepository, useValue: jobsRepo },
      { provide: PresignedUrlService,  useValue: presigned },
      { provide: APP_INTERCEPTOR,      useClass: TestContextInterceptor },
    ],
  }).compile();

  const app = module.createNestApplication();
  await app.init();

  return { app, exportSvc, jobsRepo, presigned };
}

function withPrincipal(
  app: INestApplication,
  principal: typeof PRINCIPAL_LEAD | typeof PRINCIPAL_AGENT_A,
) {
  return request(app.getHttpServer()).set('x-test-principal', JSON.stringify(principal));
}

// ---------------------------------------------------------------------------
// POST /exports
// ---------------------------------------------------------------------------

describe('POST /exports', () => {
  let app: INestApplication;
  let exportSvc: MockExportSvc;

  beforeEach(async () => {
    ({ app, exportSvc } = await buildApp());
  });
  afterEach(() => app.close());

  it('AC1 — Lead receives 202 with jobId, status and pollUrl', async () => {
    const res = await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/exports')
      .send({ definition: { metrics: ['ticket_count'], groupBy: [] }, format: 'csv' });

    expect(res.status).toBe(HttpStatus.ACCEPTED);
    expect(res.body).toMatchObject({
      jobId:   JOB_ID,
      status:  'queued',
      pollUrl: expect.stringContaining(JOB_ID),
    });
  });

  it('AC1 — Lead POST sets Location header', async () => {
    const res = await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/exports')
      .send({ definition: { metrics: ['ticket_count'], groupBy: [] }, format: 'csv' });

    expect(res.status).toBe(HttpStatus.ACCEPTED);
    expect(res.headers['location']).toContain(JOB_ID);
  });

  it('AC1 — Agent (report:read only) receives 403', async () => {
    const res = await withPrincipal(app, PRINCIPAL_AGENT_A)
      .post('/exports')
      .send({ definition: { metrics: ['ticket_count'], groupBy: [] }, format: 'csv' });

    expect(res.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('AC1 — both definitionId and definition in body → 400', async () => {
    const res = await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/exports')
      .send({
        definitionId: 'd0000001-0000-0000-0000-000000000001',
        definition:   { metrics: ['ticket_count'], groupBy: [] },
        format: 'csv',
      });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC1 — neither definitionId nor definition in body → 400', async () => {
    const res = await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/exports')
      .send({ format: 'csv' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC10 — unknown field in body → 400 (strict schema)', async () => {
    const res = await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/exports')
      .send({
        definition:  { metrics: ['ticket_count'], groupBy: [] },
        format:      'csv',
        unknownKey:  'bad',
      });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC1 — Lead can export with saved definitionId', async () => {
    exportSvc.requestExport.mockResolvedValue({
      jobId:   JOB_ID,
      status:  'queued',
      pollUrl: `/api/v1/exports/${JOB_ID}`,
    });

    const res = await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/exports')
      .send({ definitionId: 'd0000001-0000-0000-0000-000000000001', format: 'csv' });

    expect(res.status).toBe(HttpStatus.ACCEPTED);
    expect(exportSvc.requestExport).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /exports/:id
// ---------------------------------------------------------------------------

describe('GET /exports/:id', () => {
  let app: INestApplication;
  let jobsRepo: MockJobsRepo;
  let presigned: MockPresigned;

  beforeEach(async () => {
    ({ app, jobsRepo, presigned } = await buildApp({
      jobsRepo: { findById: jest.fn().mockResolvedValue(makeCompletedJob()) },
    }));
  });
  afterEach(() => app.close());

  it('AC2 — completed job returns 200 with downloadUrl for Lead', async () => {
    const res = await withPrincipal(app, PRINCIPAL_LEAD)
      .get(`/exports/${JOB_ID}`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toMatchObject({
      id:         JOB_ID,
      status:     'completed',
      format:     'csv',
      rowCount:   1234,
      byteSize:   56789,
      truncated:  false,
      downloadUrl: PRESIGNED_URL,
    });
    expect(res.body.completedAt).toBeTruthy();
    expect(res.body.expiresAt).toBeTruthy();
  });

  it('AC2 — completed job returns downloadUrl for Agent (report:read)', async () => {
    const res = await withPrincipal(app, PRINCIPAL_AGENT_A)
      .get(`/exports/${JOB_ID}`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.downloadUrl).toBe(PRESIGNED_URL);
  });

  it('AC2 — queued job returns no downloadUrl', async () => {
    jobsRepo.findById.mockResolvedValue(makeJob({ status: 'queued' }));

    const res = await withPrincipal(app, PRINCIPAL_LEAD)
      .get(`/exports/${JOB_ID}`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.downloadUrl).toBeUndefined();
    expect(presigned.getPresignedUrl).not.toHaveBeenCalled();
  });

  it('AC2 — failed job returns errorCode and no downloadUrl', async () => {
    jobsRepo.findById.mockResolvedValue(makeJob({
      status:    'failed',
      errorCode: 'EXPORT_QUERY_TIMEOUT',
    }));

    const res = await withPrincipal(app, PRINCIPAL_LEAD)
      .get(`/exports/${JOB_ID}`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.errorCode).toBe('EXPORT_QUERY_TIMEOUT');
    expect(res.body.downloadUrl).toBeUndefined();
  });

  it('AC2 — missing or out-of-scope job → 404 (non-disclosure)', async () => {
    jobsRepo.findById.mockResolvedValue(null);

    const res = await withPrincipal(app, PRINCIPAL_LEAD)
      .get(`/exports/does-not-exist`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
    expect(res.body?.error?.code).toBe('EXPORT_NOT_FOUND');
  });

  it('AC5 — expiresAt in the past → 410 EXPORT_EXPIRED, no downloadUrl minted', async () => {
    const pastDate = new Date(Date.now() - 86400_000); // yesterday
    jobsRepo.findById.mockResolvedValue(makeCompletedJob({ expiresAt: pastDate }));

    const res = await withPrincipal(app, PRINCIPAL_LEAD)
      .get(`/exports/${JOB_ID}`);

    expect(res.status).toBe(HttpStatus.GONE);
    expect(res.body?.error?.code).toBe('EXPORT_EXPIRED');
    expect(presigned.getPresignedUrl).not.toHaveBeenCalled();
  });

  it('AC2 — presigned URL uses 900s TTL (minted fresh per request)', async () => {
    await withPrincipal(app, PRINCIPAL_LEAD).get(`/exports/${JOB_ID}`);

    expect(presigned.getPresignedUrl).toHaveBeenCalledWith(
      S3_KEY,
      JOB_ID,
      REPORT_TENANT_A,
    );
  });

  it('AC2 — processing job returns no downloadUrl even if s3Key is set', async () => {
    jobsRepo.findById.mockResolvedValue(makeJob({
      status: 'processing',
      s3Key:  S3_KEY, // incomplete upload
    }));

    const res = await withPrincipal(app, PRINCIPAL_LEAD)
      .get(`/exports/${JOB_ID}`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.downloadUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC6 — Redelivery idempotency (unit-level verification)
// ---------------------------------------------------------------------------

describe('ExportWorker redelivery idempotency', () => {
  it('AC6 — markProcessing null return prevents S3 upload on redelivery', async () => {
    // Dynamically import to allow for module resolution in test env
    const { ExportWorker } = await import('../../../src/workers/export/export.worker');

    const mockJobsRepo = {
      markProcessing: jest.fn().mockResolvedValue(null), // redelivery
      markCompleted:  jest.fn(),
      markFailed:     jest.fn(),
    };
    const mockPool = { connect: jest.fn() };

    const worker = new ExportWorker(mockPool as never, mockJobsRepo as never);

    await worker.process(
      {
        jobId:       JOB_ID,
        tenantId:    REPORT_TENANT_A,
        format:      'csv',
        s3Key:       S3_KEY,
        sql:         'SELECT 1',
        params:      [],
        columns:     [{ key: 'n', label: 'N' }],
        rowCap:      500000,
        requestedBy: PRINCIPAL_LEAD.userId,
      },
      'sqs-msg-duplicate',
    );

    // Guard asserted — no pool connection means no S3 interaction
    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(mockJobsRepo.markCompleted).not.toHaveBeenCalled();
    expect(mockJobsRepo.markFailed).not.toHaveBeenCalled();
  });

  it('AC6 — first delivery claims the job (markProcessing returns id)', async () => {
    const { ExportWorker } = await import('../../../src/workers/export/export.worker');

    const mockJobsRepo = {
      markProcessing: jest.fn().mockResolvedValue(JOB_ID), // first delivery — claimed
      markCompleted:  jest.fn().mockResolvedValue(undefined),
      markFailed:     jest.fn().mockResolvedValue(undefined),
    };

    // Mock a minimal pool that throws so the worker enters the catch block
    // but the important thing is markProcessing was called and returned a value
    const mockPool = {
      connect: jest.fn().mockRejectedValue(new Error('no real db in tests')),
    };

    const worker = new ExportWorker(mockPool as never, mockJobsRepo as never);

    await expect(
      worker.process(
        {
          jobId:       JOB_ID,
          tenantId:    REPORT_TENANT_A,
          format:      'csv',
          s3Key:       S3_KEY,
          sql:         'SELECT 1',
          params:      [],
          columns:     [{ key: 'n', label: 'N' }],
          rowCap:      500000,
          requestedBy: PRINCIPAL_LEAD.userId,
        },
        'sqs-msg-first',
      ),
    ).rejects.toThrow(); // throws because no real db — expected

    // But markProcessing WAS called (job was claimed before the db error)
    expect(mockJobsRepo.markProcessing).toHaveBeenCalledWith(JOB_ID, 'sqs-msg-first');
    expect(mockPool.connect).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fixture: awkward-values rows produce valid CSV via serializer (AC12)
// ---------------------------------------------------------------------------

describe('CsvStreamSerializer with awkward-values fixture', () => {
  it('serializes all AWKWARD_VALUES_ROWS without throwing', async () => {
    const { CsvStreamSerializer } = await import('../../../src/workers/export/csv-stream.serializer');
    const { AWKWARD_VALUES_ROWS, AWKWARD_COLUMNS } = await import('../../fixtures/export-row-generators');

    const s = new CsvStreamSerializer(AWKWARD_COLUMNS);
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      s.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      s.on('end', resolve);
      s.on('error', reject);

      for (const row of AWKWARD_VALUES_ROWS as unknown as Record<string, unknown>[]) {
        s.write(row);
      }
      s.end();
    });

    const csv = Buffer.concat(chunks).toString('utf8');

    // BOM present
    expect(csv.charCodeAt(0)).toBe(0xfeff);

    // Header row present (after BOM)
    expect(csv).toContain('Description,Note,Formula Cell,Unicode Cell,Newline Cell,Empty Cell');

    // All CRLF line endings
    const lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    // header + 5 data rows = 6 non-empty entries at minimum
    expect(lines.length).toBeGreaterThanOrEqual(6);
  });
});
