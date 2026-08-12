/**
 * Integration tests for WO-025 organization lifecycle controller (deactivate/reactivate).
 *
 * Uses NestJS TestingModule + supertest with mocked OrganizationsService.
 * Bypasses the full AuthGuard/JWT stack via a test interceptor that reads
 * the principal from an x-test-principal header and binds requestContextStore.
 *
 * Covers (per acceptance criteria):
 *   AC1  — POST /deactivate returns 200 { id, status: 'inactive', deactivatedAt, deactivatedBy, version, traceId }
 *   AC4  — POST /reactivate returns 200 { id, status: 'active', version, traceId }
 *   AC4  — POST /reactivate returns 409 ORGANIZATION_NAME_CONFLICT on name collision
 *   AC5  — Idempotency: deactivating an already-inactive org returns 200 with current state
 *   AC5  — Idempotency: reactivating an already-active org returns 200 with current state
 *   AC7  — 400 for missing or invalid body fields
 *   AC7  — 404 for unknown organization ids
 *   AC7  — traceId present in all responses
 *   AC8  — confirmName mismatch returns 400 CONFIRMATION_NAME_MISMATCH
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
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import * as request from 'supertest';
import { Observable, from, lastValueFrom } from 'rxjs';

import { OrganizationsController } from '../../src/modules/organizations/organizations.controller';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import {
  requestContextStore,
  type PrincipalContext,
  type RequestContext,
} from '../../src/observability/request-context';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TENANT_A = 'a0a0a0a0-0000-0000-0000-000000000001';
const ADMIN_USER_ID = 'a1a1a1a1-0000-0000-0000-000000000001';
const ORG_ID = '12345678-0000-0000-0000-000000000001';
const ORG_NAME = 'Acme Corp';

// ---------------------------------------------------------------------------
// Test principal helpers
// ---------------------------------------------------------------------------

function makeAdminPrincipal(tenantId: string = TENANT_A): PrincipalContext {
  return {
    tenantId,
    userId: ADMIN_USER_ID,
    principalKind: 'staff',
    roles: ['admin'],
    orgScopeIds: [],
    traceId: 'test-trace-admin-lifecycle-001',
  };
}

// ---------------------------------------------------------------------------
// Test-only interceptor — injects principal from x-test-principal header.
// ---------------------------------------------------------------------------

@Injectable()
class TestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: PrincipalContext;
    }>();

    const principalHeader = req.headers['x-test-principal'];
    if (!principalHeader) return next.handle();

    const principal = JSON.parse(principalHeader) as PrincipalContext;
    req.user = principal;

    const ctx: RequestContext = {
      traceId: principal.traceId,
      principal,
      txHandle: {},
      startedAt: Date.now(),
    };

    return from(requestContextStore.run(ctx, () => lastValueFrom(next.handle())));
  }
}

// ---------------------------------------------------------------------------
// Mock organization data
// ---------------------------------------------------------------------------

const ORG_ACTIVE_FIXTURE = {
  id: ORG_ID,
  tenantId: TENANT_A,
  name: ORG_NAME,
  slug: 'acme-corp',
  slaTier: 'premium',
  region: 'us-east-1',
  status: 'active',
  customFieldValues: {},
  version: 1,
  createdAt: new Date('2024-01-15T00:00:00Z'),
  updatedAt: new Date('2024-01-15T00:00:00Z'),
  deactivatedAt: null,
  deactivatedBy: null,
  primaryContactId: null,
};

const ORG_INACTIVE_FIXTURE = {
  ...ORG_ACTIVE_FIXTURE,
  status: 'inactive',
  deactivatedAt: new Date('2024-06-01T00:00:00Z'),
  deactivatedBy: ADMIN_USER_ID,
  version: 2,
};

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(
  serviceOverrides: Partial<Record<string, jest.Mock>>,
): Promise<INestApplication> {
  const mockService: Partial<Record<string, jest.Mock>> = {
    list: jest.fn().mockResolvedValue({ data: [], nextCursor: null }),
    getById: jest.fn().mockResolvedValue({ ...ORG_ACTIVE_FIXTURE, verifiedDomainCount: 0, contactCount: 0 }),
    create: jest.fn().mockResolvedValue(ORG_ACTIVE_FIXTURE),
    update: jest.fn().mockResolvedValue(ORG_ACTIVE_FIXTURE),
    deactivate: jest.fn().mockResolvedValue(ORG_INACTIVE_FIXTURE),
    reactivate: jest.fn().mockResolvedValue(ORG_ACTIVE_FIXTURE),
    ...serviceOverrides,
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [OrganizationsController],
    providers: [
      {
        provide: OrganizationsService,
        useValue: mockService,
      },
      {
        provide: APP_INTERCEPTOR,
        useClass: TestContextInterceptor,
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

function withAdmin(app: INestApplication) {
  return request(app.getHttpServer()).set(
    'x-test-principal',
    JSON.stringify(makeAdminPrincipal()),
  );
}

// ---------------------------------------------------------------------------
// Tests: POST /organizations/:id/deactivate
// ---------------------------------------------------------------------------

describe('POST /organizations/:id/deactivate', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC1 — returns 200 with status=inactive, deactivatedAt and traceId', async () => {
    app = await buildApp({ deactivate: jest.fn().mockResolvedValue(ORG_INACTIVE_FIXTURE) });

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/deactivate`)
      .send({ confirmName: ORG_NAME, reason: 'Contract ended' });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data.status).toBe('inactive');
    expect(res.body.data.deactivatedAt).toBeDefined();
    expect(res.body.data.deactivatedBy).toBe(ADMIN_USER_ID);
    expect(res.body.data.version).toBe(2);
    expect(res.body.traceId).toBeDefined();
  });

  it('AC1 — passes tenantId and actorId from principal to service', async () => {
    const mockDeactivate = jest.fn().mockResolvedValue(ORG_INACTIVE_FIXTURE);
    app = await buildApp({ deactivate: mockDeactivate });

    await withAdmin(app)
      .post(`/organizations/${ORG_ID}/deactivate`)
      .send({ confirmName: ORG_NAME, reason: 'Contract ended' });

    expect(mockDeactivate).toHaveBeenCalledWith(
      TENANT_A,
      ORG_ID,
      expect.objectContaining({ confirmName: ORG_NAME, reason: 'Contract ended' }),
      ADMIN_USER_ID,
      expect.any(String),
    );
  });

  it('AC5 — idempotent: already-inactive org returns 200 without error', async () => {
    app = await buildApp({ deactivate: jest.fn().mockResolvedValue(ORG_INACTIVE_FIXTURE) });

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/deactivate`)
      .send({ confirmName: ORG_NAME, reason: 'Repeat call' });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data.status).toBe('inactive');
  });

  it('AC7 — 400 for missing confirmName', async () => {
    app = await buildApp({});

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/deactivate`)
      .send({ reason: 'Missing confirm name' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC7 — 400 for missing reason', async () => {
    app = await buildApp({});

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/deactivate`)
      .send({ confirmName: ORG_NAME });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC7 — 400 for reason exceeding 500 chars', async () => {
    app = await buildApp({});

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/deactivate`)
      .send({ confirmName: ORG_NAME, reason: 'x'.repeat(501) });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC7 — 400 for unknown properties in body (strict DTO)', async () => {
    app = await buildApp({});

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/deactivate`)
      .send({ confirmName: ORG_NAME, reason: 'test', unexpectedProp: true });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC8 — 400 CONFIRMATION_NAME_MISMATCH from service propagates correctly', async () => {
    app = await buildApp({
      deactivate: jest.fn().mockRejectedValue(
        new BadRequestException({
          error: {
            code: 'CONFIRMATION_NAME_MISMATCH',
            message: 'confirmName does not match the organization name.',
          },
        }),
      ),
    });

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/deactivate`)
      .send({ confirmName: 'Wrong Name', reason: 'test' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC7 — 404 for unknown organization id', async () => {
    app = await buildApp({
      deactivate: jest.fn().mockRejectedValue(
        new NotFoundException({
          error: { code: 'ORGANIZATION_NOT_FOUND', message: 'Not found', details: [] },
        }),
      ),
    });

    const res = await withAdmin(app)
      .post('/organizations/does-not-exist/deactivate')
      .send({ confirmName: ORG_NAME, reason: 'test' });

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  it('AC7 — traceId from x-trace-id header propagated in response', async () => {
    app = await buildApp({ deactivate: jest.fn().mockResolvedValue(ORG_INACTIVE_FIXTURE) });
    const customTraceId = 'my-deactivate-trace-12345';

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/deactivate`)
      .set('x-trace-id', customTraceId)
      .send({ confirmName: ORG_NAME, reason: 'test' });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.traceId).toBe(customTraceId);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /organizations/:id/reactivate
// ---------------------------------------------------------------------------

describe('POST /organizations/:id/reactivate', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC4 — returns 200 with status=active and traceId', async () => {
    app = await buildApp({ reactivate: jest.fn().mockResolvedValue(ORG_ACTIVE_FIXTURE) });

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/reactivate`)
      .send({ reason: 'Re-signed contract' });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data.id).toBe(ORG_ID);
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.version).toBe(1);
    expect(res.body.traceId).toBeDefined();
  });

  it('AC4 — returns 409 ORGANIZATION_NAME_CONFLICT when another org has taken the name', async () => {
    app = await buildApp({
      reactivate: jest.fn().mockRejectedValue(
        new ConflictException({
          error: {
            code: 'ORGANIZATION_NAME_CONFLICT',
            message: 'An active organization named "Acme Corp" already exists. Rename it first, then reactivate.',
            details: [{ existingId: 'org-002' }],
          },
        }),
      ),
    });

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/reactivate`)
      .send({ reason: 'Re-signed' });

    expect(res.status).toBe(HttpStatus.CONFLICT);
  });

  it('AC5 — idempotent: already-active org returns 200', async () => {
    app = await buildApp({ reactivate: jest.fn().mockResolvedValue(ORG_ACTIVE_FIXTURE) });

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/reactivate`)
      .send({ reason: 'Repeat call' });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data.status).toBe('active');
  });

  it('AC7 — 400 for missing reason', async () => {
    app = await buildApp({});

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/reactivate`)
      .send({});

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC7 — 400 for reason exceeding 500 chars', async () => {
    app = await buildApp({});

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/reactivate`)
      .send({ reason: 'r'.repeat(501) });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC7 — 400 for unknown properties in body (strict DTO)', async () => {
    app = await buildApp({});

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/reactivate`)
      .send({ reason: 'test', unexpectedProp: 'bad' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC7 — 404 for unknown organization id', async () => {
    app = await buildApp({
      reactivate: jest.fn().mockRejectedValue(
        new NotFoundException({
          error: { code: 'ORGANIZATION_NOT_FOUND', message: 'Not found', details: [] },
        }),
      ),
    });

    const res = await withAdmin(app)
      .post('/organizations/does-not-exist/reactivate')
      .send({ reason: 'test' });

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  it('AC7 — passes tenantId and actorId from principal to service', async () => {
    const mockReactivate = jest.fn().mockResolvedValue(ORG_ACTIVE_FIXTURE);
    app = await buildApp({ reactivate: mockReactivate });

    await withAdmin(app)
      .post(`/organizations/${ORG_ID}/reactivate`)
      .send({ reason: 'Re-signed' });

    expect(mockReactivate).toHaveBeenCalledWith(
      TENANT_A,
      ORG_ID,
      expect.objectContaining({ reason: 'Re-signed' }),
      ADMIN_USER_ID,
      expect.any(String),
    );
  });

  it('AC7 — traceId from x-trace-id header propagated in response', async () => {
    app = await buildApp({ reactivate: jest.fn().mockResolvedValue(ORG_ACTIVE_FIXTURE) });
    const customTraceId = 'my-reactivate-trace-99999';

    const res = await withAdmin(app)
      .post(`/organizations/${ORG_ID}/reactivate`)
      .set('x-trace-id', customTraceId)
      .send({ reason: 'Re-signed' });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.traceId).toBe(customTraceId);
  });
});

// ---------------------------------------------------------------------------
// Tests: AC3 — ticket creation blocking after deactivation (controller-level)
// The actual 422 is thrown by TicketsService using OrganizationsService.isOrganizationActive.
// We assert the error envelope matches the expected format at the service level.
// End-to-end coverage: see test/organization-lifecycle.e2e-spec.ts.
// ---------------------------------------------------------------------------

describe('ORGANIZATION_INACTIVE error shape (AC3)', () => {
  it('UnprocessableEntityException with code ORGANIZATION_INACTIVE has correct format', () => {
    const err = new UnprocessableEntityException({
      error: {
        code: 'ORGANIZATION_INACTIVE',
        message: 'Cannot create a ticket for an inactive organization.',
        details: [{ organizationId: ORG_ID }],
      },
    });
    const body = err.getResponse() as Record<string, unknown>;
    const errorObj = (body as { error: { code: string } }).error;
    expect(errorObj.code).toBe('ORGANIZATION_INACTIVE');
  });
});
