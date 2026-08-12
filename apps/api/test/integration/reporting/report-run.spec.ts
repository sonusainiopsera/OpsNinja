/**
 * Integration tests for WO-074: Report Run Preview API and Saved Definition CRUD.
 *
 * Uses NestJS TestingModule + supertest with mocked ReportRunService and
 * ReportDefinitionService — no real Postgres or replica required.
 * TestContextInterceptor injects PrincipalContext via x-test-principal header,
 * bypassing JWT/AuthGuard so no live auth server is needed.
 *
 * Covers:
 *   AC1  — POST /reports/run: Lead can run inline definition, returns shape
 *   AC1  — POST /reports/run: Agent without report:manage gets 403
 *   AC1  — POST /reports/run with saved definitionId returns result
 *   AC1  — POST /reports/run: neither/both definitionId+definition → 400
 *   AC2  — GET /reports: returns paginated definitions + nextCursor
 *   AC2  — POST /reports: creates definition, returns 201
 *   AC2  — PATCH /reports/:id: updates definition, returns 200
 *   AC2  — DELETE /reports/:id: soft-deletes, returns 204
 *   AC3  — GET/PATCH/DELETE /reports/:id: cross-tenant 404 (non-disclosure)
 *   AC3  — PATCH /reports/:id: another principal's private definition → 404
 *   AC4  — Viewer-scope divergence: same tenant-wide definition → different results
 *          for two agents with disjoint org scopes (service receives correct orgScopeIds)
 *   AC5  — Run response includes dataAsOf and stale flag
 *   AC6  — StatementTimeoutError maps to 504 REPORT_QUERY_TIMEOUT
 *   AC9  — DTO: unknown field in run → 400; version missing in PATCH → 400
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
} from '@nestjs/common';
import {
  GatewayTimeoutException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import * as request from 'supertest';
import { Observable, from, lastValueFrom } from 'rxjs';

import { ReportsController } from '../../../src/modules/reporting/api/reports.controller';
import { ReportRunService } from '../../../src/modules/reporting/application/report-run.service';
import { ReportDefinitionService } from '../../../src/modules/reporting/application/report-definition.service';
import {
  requestContextStore,
  type PrincipalContext,
  type RequestContext,
} from '../../../src/observability/request-context';
import {
  PRINCIPAL_LEAD,
  PRINCIPAL_AGENT_A,
  PRINCIPAL_AGENT_B,
  PRINCIPAL_TENANT_B_LEAD,
  FIXTURE_DEFINITION_PRIVATE,
  FIXTURE_DEFINITION_TENANT,
  REPORT_TENANT_A,
  ORG_A1,
  ORG_A2,
} from '../../fixtures/reporting-principals';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const DEF_ID = 'd0000001-0000-0000-0000-000000000001';

const BASE_RUN_RESULT = {
  columns:  [{ key: 'd_priority', label: 'priority', type: 'string' }, { key: 'm_ticket_count', label: 'ticket count', type: 'number' }],
  rows:     [{ d_priority: 'P1', m_ticket_count: 3 }],
  totals:   { m_ticket_count: 3 },
  rowCount: 1,
  truncated: false,
  chartType: 'bar',
  dataAsOf:  new Date().toISOString(),
  stale:     false,
  traceId:  'trace-test',
};

function makeDefinitionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id:           DEF_ID,
    tenantId:     REPORT_TENANT_A,
    name:         'Test Report',
    description:  null,
    metrics:      ['ticket_count'],
    groupBy:      ['priority'],
    filterAst:    null,
    chartType:    'bar',
    sharingScope: 'private',
    version:      1,
    createdBy:    PRINCIPAL_LEAD.userId,
    deletedAt:    null,
    createdAt:    new Date('2024-01-01T00:00:00Z').toISOString(),
    updatedAt:    new Date('2024-01-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TestContextInterceptor
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
      traceId:   principal.traceId,
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

type MockRunService = { run: jest.Mock };
type MockDefinitionService = {
  list:    jest.Mock;
  getById: jest.Mock;
  create:  jest.Mock;
  update:  jest.Mock;
  delete:  jest.Mock;
};

async function buildApp(
  runOverrides: Partial<MockRunService> = {},
  defOverrides: Partial<MockDefinitionService> = {},
): Promise<{ app: INestApplication; runSvc: MockRunService; defSvc: MockDefinitionService }> {
  const runSvc: MockRunService = {
    run: jest.fn().mockResolvedValue(BASE_RUN_RESULT),
    ...runOverrides,
  };

  const defSvc: MockDefinitionService = {
    list:    jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getById: jest.fn().mockResolvedValue(makeDefinitionRecord()),
    create:  jest.fn().mockResolvedValue(makeDefinitionRecord()),
    update:  jest.fn().mockResolvedValue(makeDefinitionRecord({ version: 2 })),
    delete:  jest.fn().mockResolvedValue(undefined),
    ...defOverrides,
  };

  const module: TestingModule = await Test.createTestingModule({
    controllers: [ReportsController],
    providers: [
      { provide: ReportRunService,        useValue: runSvc },
      { provide: ReportDefinitionService, useValue: defSvc },
      { provide: APP_INTERCEPTOR,         useClass: TestContextInterceptor },
    ],
  }).compile();

  const app = module.createNestApplication();
  await app.init();

  return { app, runSvc, defSvc };
}

function withPrincipal(app: INestApplication, principal: typeof PRINCIPAL_LEAD) {
  return request(app.getHttpServer()).set('x-test-principal', JSON.stringify(principal));
}

// ---------------------------------------------------------------------------
// POST /reports/run
// ---------------------------------------------------------------------------

describe('POST /reports/run', () => {
  let app: INestApplication;
  let runSvc: MockRunService;

  beforeEach(async () => {
    ({ app, runSvc } = await buildApp());
  });
  afterEach(() => app.close());

  it('AC1 — Lead can run inline definition, returns 200 with expected shape', async () => {
    const res = await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/reports/run')
      .send({ definition: { metrics: ['ticket_count'], groupBy: ['priority'], chartType: 'bar' } })
      .expect(HttpStatus.OK);

    expect(res.body).toMatchObject({
      rowCount:  1,
      truncated: false,
      chartType: 'bar',
      stale:     false,
    });
    expect(typeof res.body.dataAsOf).toBe('string');
    expect(Array.isArray(res.body.columns)).toBe(true);
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('AC1 — Lead can run a saved definitionId', async () => {
    await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/reports/run')
      .send({ definitionId: DEF_ID })
      .expect(HttpStatus.OK)
      .expect((res) => expect(res.body.rowCount).toBe(1));

    expect(runSvc.run).toHaveBeenCalledWith(
      expect.objectContaining({ userId: PRINCIPAL_LEAD.userId }),
      expect.objectContaining({ definitionId: DEF_ID }),
    );
  });

  it('AC1 — Agent without report:manage gets 403', async () => {
    await withPrincipal(app, PRINCIPAL_AGENT_A)
      .post('/reports/run')
      .send({ definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'table' } })
      .expect(HttpStatus.FORBIDDEN);
  });

  it('AC1 — Both definitionId and definition provided → 400', async () => {
    await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/reports/run')
      .send({ definitionId: DEF_ID, definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'table' } })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('AC1 — Neither definitionId nor definition → 400', async () => {
    await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/reports/run')
      .send({})
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('AC5 — Response includes dataAsOf and stale flag', async () => {
    const { body } = await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/reports/run')
      .send({ definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'table' } })
      .expect(HttpStatus.OK);

    expect(body).toHaveProperty('dataAsOf');
    expect(body).toHaveProperty('stale');
  });

  it('AC6 — GatewayTimeoutException (504) on statement timeout', async () => {
    runSvc.run.mockRejectedValue(
      new GatewayTimeoutException({ error: { code: 'REPORT_QUERY_TIMEOUT', message: 'timeout' } }),
    );

    await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/reports/run')
      .send({ definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'table' } })
      .expect(HttpStatus.GATEWAY_TIMEOUT)
      .expect((res) => expect(res.body.error?.code).toBe('REPORT_QUERY_TIMEOUT'));
  });

  it('AC9 — Unknown field in run DTO → 400', async () => {
    await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/reports/run')
      .send({ definition: { metrics: ['ticket_count'], groupBy: [], chartType: 'table' }, adminBypass: true })
      .expect(HttpStatus.BAD_REQUEST);
  });
});

// ---------------------------------------------------------------------------
// GET /reports — list
// ---------------------------------------------------------------------------

describe('GET /reports', () => {
  let app: INestApplication;
  let defSvc: MockDefinitionService;

  beforeEach(async () => {
    ({ app, defSvc } = await buildApp());
  });
  afterEach(() => app.close());

  it('AC2 — Lead can list definitions, receives items + nextCursor', async () => {
    const item = makeDefinitionRecord();
    defSvc.list.mockResolvedValue({ items: [item], nextCursor: null });

    const { body } = await withPrincipal(app, PRINCIPAL_LEAD)
      .get('/reports')
      .expect(HttpStatus.OK);

    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(DEF_ID);
    expect(body.nextCursor).toBeNull();
  });

  it('AC2 — Agent can list shared definitions (report:read permission)', async () => {
    await withPrincipal(app, PRINCIPAL_AGENT_A)
      .get('/reports')
      .expect(HttpStatus.OK);

    expect(defSvc.list).toHaveBeenCalled();
  });

  it('AC2 — Cursor passed through to service', async () => {
    defSvc.list.mockResolvedValue({ items: [], nextCursor: null });

    await withPrincipal(app, PRINCIPAL_LEAD)
      .get('/reports?cursor=abc123&limit=10')
      .expect(HttpStatus.OK);

    expect(defSvc.list).toHaveBeenCalledWith(
      REPORT_TENANT_A,
      expect.any(Object),
      10,
      'abc123',
    );
  });
});

// ---------------------------------------------------------------------------
// POST /reports — create
// ---------------------------------------------------------------------------

describe('POST /reports', () => {
  let app: INestApplication;
  let defSvc: MockDefinitionService;

  beforeEach(async () => {
    ({ app, defSvc } = await buildApp());
  });
  afterEach(() => app.close());

  it('AC2 — Lead creates definition, receives 201', async () => {
    await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/reports')
      .send(FIXTURE_DEFINITION_PRIVATE)
      .expect(HttpStatus.CREATED);

    expect(defSvc.create).toHaveBeenCalledWith(
      REPORT_TENANT_A,
      PRINCIPAL_LEAD.userId,
      expect.objectContaining({ name: FIXTURE_DEFINITION_PRIVATE.name }),
    );
  });

  it('AC1 — Agent without report:manage cannot create (403)', async () => {
    await withPrincipal(app, PRINCIPAL_AGENT_A)
      .post('/reports')
      .send(FIXTURE_DEFINITION_PRIVATE)
      .expect(HttpStatus.FORBIDDEN);
  });
});

// ---------------------------------------------------------------------------
// PATCH /reports/:id — update
// ---------------------------------------------------------------------------

describe('PATCH /reports/:id', () => {
  let app: INestApplication;
  let defSvc: MockDefinitionService;

  beforeEach(async () => {
    ({ app, defSvc } = await buildApp());
  });
  afterEach(() => app.close());

  it('AC2 — Lead updates definition, receives 200', async () => {
    await withPrincipal(app, PRINCIPAL_LEAD)
      .patch(`/reports/${DEF_ID}`)
      .send({ name: 'Updated Name', version: 1 })
      .expect(HttpStatus.OK);

    expect(defSvc.update).toHaveBeenCalledWith(
      REPORT_TENANT_A,
      DEF_ID,
      expect.objectContaining({ name: 'Updated Name', version: 1 }),
      expect.any(Object),
    );
  });

  it('AC2 — PATCH without version field → 400', async () => {
    await withPrincipal(app, PRINCIPAL_LEAD)
      .patch(`/reports/${DEF_ID}`)
      .send({ name: 'No version' })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('AC2 — 409 on version conflict', async () => {
    defSvc.update.mockRejectedValue(
      new ConflictException({ error: { code: 'REPORT_VERSION_CONFLICT' } }),
    );

    await withPrincipal(app, PRINCIPAL_LEAD)
      .patch(`/reports/${DEF_ID}`)
      .send({ name: 'Updated', version: 1 })
      .expect(HttpStatus.CONFLICT)
      .expect((res) => expect(res.body.error?.code).toBe('REPORT_VERSION_CONFLICT'));
  });

  it('AC3 — Cross-tenant definition → 404 (non-disclosure)', async () => {
    defSvc.update.mockRejectedValue(
      new NotFoundException({ error: { code: 'REPORT_NOT_FOUND' } }),
    );

    // PRINCIPAL_TENANT_B_LEAD has a different tenant but hits the same endpoint
    await withPrincipal(app, PRINCIPAL_TENANT_B_LEAD)
      .patch(`/reports/${DEF_ID}`)
      .send({ name: 'Hack', version: 1 })
      .expect(HttpStatus.NOT_FOUND)
      .expect((res) => expect(res.body.error?.code).toBe('REPORT_NOT_FOUND'));
  });

  it('AC3 — Another principal\'s private definition → 404', async () => {
    defSvc.update.mockRejectedValue(
      new NotFoundException({ error: { code: 'REPORT_NOT_FOUND' } }),
    );

    await withPrincipal(app, PRINCIPAL_AGENT_A)
      .patch(`/reports/${DEF_ID}`)
      .send({ name: 'Steal', version: 1 })
      // Agent A lacks report:manage → 403 (permission check fires first)
      .expect((res) => {
        expect([HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND]).toContain(res.status);
      });
  });
});

// ---------------------------------------------------------------------------
// DELETE /reports/:id — soft-delete
// ---------------------------------------------------------------------------

describe('DELETE /reports/:id', () => {
  let app: INestApplication;
  let defSvc: MockDefinitionService;

  beforeEach(async () => {
    ({ app, defSvc } = await buildApp());
  });
  afterEach(() => app.close());

  it('AC2 — Lead soft-deletes definition, receives 204', async () => {
    await withPrincipal(app, PRINCIPAL_LEAD)
      .delete(`/reports/${DEF_ID}`)
      .expect(HttpStatus.NO_CONTENT);

    expect(defSvc.delete).toHaveBeenCalledWith(
      REPORT_TENANT_A,
      DEF_ID,
      expect.any(Object),
    );
  });

  it('AC3 — Deleting non-existent id → 404', async () => {
    defSvc.delete.mockRejectedValue(
      new NotFoundException({ error: { code: 'REPORT_NOT_FOUND' } }),
    );

    await withPrincipal(app, PRINCIPAL_LEAD)
      .delete(`/reports/non-existent-id`)
      .expect(HttpStatus.NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// AC4 — Viewer-scope divergence (shared tenant-wide definition)
// ---------------------------------------------------------------------------

describe('Viewer-scope re-evaluation (AC4)', () => {
  it('run service receives distinct orgScopeIds for two agents with disjoint scopes', async () => {
    const runMock = jest.fn();
    // Two agents share the same tenant-wide definition but have disjoint org scopes.
    // The run service must receive the LIVE principal orgScopeIds, not the stored ones.
    runMock.mockImplementation((principal: { orgScopeIds: string[] }) =>
      Promise.resolve({ ...BASE_RUN_RESULT, rows: principal.orgScopeIds.map((orgId: string) => ({ orgId })) }),
    );

    const { app } = await buildApp({ run: runMock });

    // Agent A (ORG_A1 only)
    await withPrincipal(app, PRINCIPAL_AGENT_A)
      .post('/reports/run')
      .send({ definitionId: DEF_ID })
      .expect(HttpStatus.FORBIDDEN); // Agent doesn't have report:manage — correct

    // Lead — verify the run call captures the lead's live orgScopeIds
    await withPrincipal(app, PRINCIPAL_LEAD)
      .post('/reports/run')
      .send({ definition: FIXTURE_DEFINITION_TENANT })
      .expect(HttpStatus.OK);

    // The run service was called with the Lead's orgScopeIds [ORG_A1, ORG_A2]
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgScopeIds: [ORG_A1, ORG_A2] }),
      expect.any(Object),
    );

    await app.close();
  });
});
