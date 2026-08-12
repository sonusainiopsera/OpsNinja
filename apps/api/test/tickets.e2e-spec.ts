/**
 * Tickets controller integration tests — WO-032.
 *
 * Covers:
 *   AC1  — POST /tickets accepts canonical fields, rejects unknown properties with 400
 *   AC2  — tenant_id stamped from principal; any body attempt rejected with 400
 *   AC3  — GET /tickets/:id returns canonical TicketDto; unknown/cross-tenant id → 404
 *   AC4  — Portal org mismatch → 422 PORTAL_ORG_MISMATCH
 *   AC5  — Agent org-scope enforced (out-of-scope → service returns NotFoundException)
 *   AC6  — Audit record: service.create called, audit verified in unit tests
 *   AC8  — create-then-read for agent and portal; cross-tenant read returns 404
 *
 * Uses NestJS TestingModule + supertest with mocked TicketsService.
 * The TestContextInterceptor bypasses the JWT AuthGuard stack and injects
 * a principal context directly via x-test-principal header, matching the
 * pattern used by organizations.api.spec.ts.
 *
 * No real database is required — all DB calls are intercepted by the mock service.
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
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import * as request from 'supertest';
import { Observable, from, lastValueFrom } from 'rxjs';

import { TicketsController } from '../src/modules/tickets/tickets.controller';
import { TicketsService } from '../src/modules/tickets/tickets.service';
import {
  requestContextStore,
  type PrincipalContext,
  type RequestContext,
} from '../src/observability/request-context';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

const TENANT_A = 'aa000000-1000-0000-0000-000000000001';
const TENANT_B = 'bb000000-1000-0000-0000-000000000001';
const ORG_A_ID = 'aa000000-1000-0001-0000-000000000001';
const ORG_B_ID = 'bb000000-1000-0001-0000-000000000001';
const TICKET_ID = 'aa000000-1000-0002-0000-000000000001';
const USER_A_ADMIN = 'aa000000-1000-0003-0000-000000000001';
const USER_A_AGENT = 'aa000000-1000-0003-0000-000000000002';
const USER_B_ADMIN = 'bb000000-1000-0003-0000-000000000001';
const USER_PORTAL_A = 'aa000000-1000-0003-0000-000000000003';

// ---------------------------------------------------------------------------
// Principal factories
// ---------------------------------------------------------------------------

function makeAdminPrincipal(tenantId = TENANT_A): PrincipalContext {
  return {
    tenantId,
    userId: tenantId === TENANT_A ? USER_A_ADMIN : USER_B_ADMIN,
    principalKind: 'staff',
    roles: ['admin'],
    orgScopeIds: [],
    permissions: ['ticket:create', 'ticket:read', 'ticket:update'],
    traceId: `trace-admin-${tenantId.slice(0, 4)}`,
  } as PrincipalContext;
}

function makeAgentPrincipal(
  tenantId = TENANT_A,
  orgScopeIds: string[] = [ORG_A_ID],
): PrincipalContext {
  return {
    tenantId,
    userId: USER_A_AGENT,
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds,
    permissions: ['ticket:create', 'ticket:read'],
    traceId: `trace-agent-${tenantId.slice(0, 4)}`,
  } as PrincipalContext;
}

function makePortalPrincipal(
  tenantId = TENANT_A,
  boundOrganizationId = ORG_A_ID,
): PrincipalContext {
  return {
    tenantId,
    userId: USER_PORTAL_A,
    principalKind: 'portal',
    roles: ['portal_user'],
    orgScopeIds: [boundOrganizationId],
    boundOrganizationId,
    permissions: ['ticket:create', 'ticket:read'],
    traceId: 'trace-portal-aa',
  } as PrincipalContext;
}

// ---------------------------------------------------------------------------
// Canonical TicketDto fixture
// ---------------------------------------------------------------------------

const TICKET_DTO = {
  id: TICKET_ID,
  ticketNumber: 42,
  status: 'new',
  priority: 'P2',
  subject: 'Login service is down',
  description: 'Users cannot authenticate.',
  organization: { id: ORG_A_ID, name: 'Acme Corp', slaTier: 'premium' },
  requester: null,
  assignee: null,
  category: null,
  tags: [],
  sla: { targetAt: null, state: null },
  aiStatus: null,
  customFields: {},
  version: 1,
  createdAt: '2024-01-15T00:00:00.000Z',
  updatedAt: '2024-01-15T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// TestContextInterceptor — injects PrincipalContext from x-test-principal header.
// Bypasses JWT validation + DB transaction setup; allows service-level testing.
// ---------------------------------------------------------------------------

@Injectable()
class TestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: PrincipalContext;
    }>();

    const principalHeader = req.headers['x-test-principal'];
    if (!principalHeader) {
      return next.handle();
    }

    const principal = JSON.parse(principalHeader) as PrincipalContext;
    req.user = principal;

    const ctx: RequestContext = {
      traceId: principal.traceId,
      principal,
      txHandle: {} as never,
      startedAt: Date.now(),
    };

    return from(requestContextStore.run(ctx, () => lastValueFrom(next.handle())));
  }
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(
  serviceOverrides: Partial<{
    create: jest.Mock;
    findById: jest.Mock;
    update: jest.Mock;
    resolve: jest.Mock;
  }>,
): Promise<INestApplication> {
  const mockService = {
    create: jest.fn().mockResolvedValue(TICKET_DTO),
    findById: jest.fn().mockResolvedValue(TICKET_DTO),
    update: jest.fn().mockResolvedValue(TICKET_DTO),
    resolve: jest.fn().mockResolvedValue(TICKET_DTO),
    ...serviceOverrides,
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [TicketsController],
    providers: [
      { provide: TicketsService, useValue: mockService },
      { provide: APP_INTERCEPTOR, useClass: TestContextInterceptor },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

function withPrincipal(app: INestApplication, principal: PrincipalContext) {
  return request(app.getHttpServer()).set(
    'x-test-principal',
    JSON.stringify(principal),
  );
}

// ---------------------------------------------------------------------------
// POST /tickets
// ---------------------------------------------------------------------------

describe('POST /tickets', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC1 — 201: creates ticket for admin principal with canonical DTO', async () => {
    app = await buildApp({});

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post('/tickets')
      .send({
        subject: 'Login service is down',
        organization_id: ORG_A_ID,
        priority: 'P2',
      });

    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.data).toMatchObject({ id: TICKET_ID, subject: 'Login service is down' });
    expect(res.body.traceId).toBeDefined();
  });

  it('AC1 — 400: rejects unknown property with structured error envelope', async () => {
    app = await buildApp({});

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post('/tickets')
      .send({
        subject: 'Test ticket',
        organization_id: ORG_A_ID,
        unknown_field: 'should be rejected',
      });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC2 — 400: rejects tenant_id in body (server stamps from principal)', async () => {
    app = await buildApp({});

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post('/tickets')
      .send({
        subject: 'Test ticket',
        organization_id: ORG_A_ID,
        tenant_id: 'bbbbbbbb-0000-0000-0000-000000000099',
      });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC1 — 400: rejects missing subject', async () => {
    app = await buildApp({});

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post('/tickets')
      .send({ organization_id: ORG_A_ID });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC1 — 400: rejects subject exceeding 255 chars', async () => {
    app = await buildApp({});

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post('/tickets')
      .send({
        subject: 'x'.repeat(256),
        organization_id: ORG_A_ID,
      });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC1 — 400: rejects invalid priority value', async () => {
    app = await buildApp({});

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post('/tickets')
      .send({
        subject: 'Test',
        organization_id: ORG_A_ID,
        priority: 'CRITICAL',
      });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC4 — 422: portal org mismatch returns PORTAL_ORG_MISMATCH', async () => {
    const err = new UnprocessableEntityException({
      error: {
        code: 'PORTAL_ORG_MISMATCH',
        message: 'Portal users may only create tickets for their own organisation.',
        details: [{ requestedOrgId: ORG_B_ID }],
      },
    });
    app = await buildApp({ create: jest.fn().mockRejectedValue(err) });

    const res = await withPrincipal(app, makePortalPrincipal(TENANT_A, ORG_A_ID))
      .post('/tickets')
      .send({
        subject: 'Cross-org attempt',
        organization_id: ORG_B_ID,
      });

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    // body may be wrapped by the exception filter
    expect(JSON.stringify(res.body)).toContain('PORTAL_ORG_MISMATCH');
  });

  it('AC5 — 404: agent out-of-scope org returns 404 (existence non-disclosure)', async () => {
    const err = new NotFoundException({
      error: { code: 'ORGANIZATION_NOT_FOUND', message: 'Organization not found.' },
    });
    app = await buildApp({ create: jest.fn().mockRejectedValue(err) });

    const res = await withPrincipal(app, makeAgentPrincipal(TENANT_A, ['org-different']))
      .post('/tickets')
      .send({
        subject: 'Out-of-scope attempt',
        organization_id: ORG_A_ID,
      });

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  it('AC2 — tenant_id stamped from principal (service called with principal context)', async () => {
    const mockCreate = jest.fn().mockResolvedValue(TICKET_DTO);
    app = await buildApp({ create: mockCreate });

    await withPrincipal(app, makeAdminPrincipal(TENANT_A))
      .post('/tickets')
      .send({ subject: 'Test', organization_id: ORG_A_ID });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A }),
      expect.objectContaining({ subject: 'Test' }),
    );
  });

  it('AC6 — service.create called (audit is written inside service per unit tests)', async () => {
    const mockCreate = jest.fn().mockResolvedValue(TICKET_DTO);
    app = await buildApp({ create: mockCreate });

    await withPrincipal(app, makeAdminPrincipal())
      .post('/tickets')
      .send({ subject: 'Audit test', organization_id: ORG_A_ID });

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// GET /tickets/:id
// ---------------------------------------------------------------------------

describe('GET /tickets/:id', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC3 — 200: returns canonical TicketDto when ticket exists in tenant', async () => {
    app = await buildApp({ findById: jest.fn().mockResolvedValue(TICKET_DTO) });

    const res = await withPrincipal(app, makeAdminPrincipal()).get(`/tickets/${TICKET_ID}`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data).toMatchObject({
      id: TICKET_ID,
      status: 'new',
      priority: 'P2',
      organization: expect.objectContaining({ id: ORG_A_ID }),
      tags: [],
      sla: expect.objectContaining({ state: null }),
    });
    expect(res.body.traceId).toBeDefined();
  });

  it('AC3 — tenant_id must NOT appear in response body', async () => {
    app = await buildApp({ findById: jest.fn().mockResolvedValue(TICKET_DTO) });

    const res = await withPrincipal(app, makeAdminPrincipal()).get(`/tickets/${TICKET_ID}`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data.tenantId).toBeUndefined();
    expect(res.body.data.tenant_id).toBeUndefined();
  });

  it('AC3 — 404: unknown ticket id returns 404', async () => {
    app = await buildApp({ findById: jest.fn().mockResolvedValue(null) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get('/tickets/00000000-dead-beef-0000-000000000000');

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
    expect(JSON.stringify(res.body)).toContain('TICKET_NOT_FOUND');
  });

  it('AC3 (AC8) — 404: cross-tenant read returns 404 (not 403 — existence non-disclosure)', async () => {
    // Service returns null when the principal is from TENANT_B but the ticket belongs to TENANT_A.
    // The repository enforces this via RLS + org-scope predicate; mocked here as null return.
    app = await buildApp({ findById: jest.fn().mockResolvedValue(null) });

    const tenantBAdmin = makeAdminPrincipal(TENANT_B);
    const res = await withPrincipal(app, tenantBAdmin).get(`/tickets/${TICKET_ID}`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
    // Must NOT be 403 — the existence of the ticket must not be disclosed
    expect(res.status).not.toBe(HttpStatus.FORBIDDEN);
  });

  it('AC3 (AC8) — 404: out-of-scope agent read returns 404', async () => {
    // Agent in Tenant A but scoped to a different org returns null from service
    app = await buildApp({ findById: jest.fn().mockResolvedValue(null) });

    const agentOutOfScope = makeAgentPrincipal(TENANT_A, ['org-other-00000000-0000-0000-0000']);
    const res = await withPrincipal(app, agentOutOfScope).get(`/tickets/${TICKET_ID}`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// AC8 — create-then-read journey across two tenants
// ---------------------------------------------------------------------------

describe('AC8: create-then-read journey (agent and portal principals, cross-tenant isolation)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await buildApp({
      create: jest.fn().mockResolvedValue(TICKET_DTO),
      findById: jest
        .fn()
        .mockImplementation((id: string) =>
          // Simulate repo scope enforcement: only returns data for the matching ticket
          id === TICKET_ID ? TICKET_DTO : null,
        ),
    });
  });

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('agent: creates a ticket (201) then reads it back (200)', async () => {
    const agentA = makeAgentPrincipal(TENANT_A, [ORG_A_ID]);

    const createRes = await withPrincipal(app, agentA)
      .post('/tickets')
      .send({ subject: 'DB pool exhausted', organization_id: ORG_A_ID, priority: 'P1' });

    expect(createRes.status).toBe(HttpStatus.CREATED);

    const createdId = createRes.body.data.id as string;
    const readRes = await withPrincipal(app, agentA).get(`/tickets/${createdId}`);

    expect(readRes.status).toBe(HttpStatus.OK);
    expect(readRes.body.data.id).toBe(createdId);
  });

  it('portal: creates a ticket (201) then reads it back (200)', async () => {
    const portalA = makePortalPrincipal(TENANT_A, ORG_A_ID);

    const createRes = await withPrincipal(app, portalA)
      .post('/tickets')
      .send({ subject: 'Cannot log in', organization_id: ORG_A_ID });

    expect(createRes.status).toBe(HttpStatus.CREATED);

    const createdId = createRes.body.data.id as string;
    const readRes = await withPrincipal(app, portalA).get(`/tickets/${createdId}`);

    expect(readRes.status).toBe(HttpStatus.OK);
    expect(readRes.body.data.id).toBe(createdId);
  });

  it('tenant B admin cannot read tenant A ticket — returns 404 (not 403)', async () => {
    // Tenant B's findById mock returns null for ticket from tenant A
    const tenantBService = {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(null), // out-of-tenant returns null
    };
    await app.close();
    app = await buildApp(tenantBService);

    const tenantBAdmin = makeAdminPrincipal(TENANT_B);
    const res = await withPrincipal(app, tenantBAdmin).get(`/tickets/${TICKET_ID}`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
    expect(res.status).not.toBe(HttpStatus.FORBIDDEN);
  });

  it('response body does not contain tenant_id (existence non-disclosure)', async () => {
    const agentA = makeAgentPrincipal(TENANT_A, [ORG_A_ID]);

    const res = await withPrincipal(app, agentA).get(`/tickets/${TICKET_ID}`);

    expect(res.status).toBe(HttpStatus.OK);
    const body = JSON.stringify(res.body.data);
    expect(body).not.toContain('"tenantId"');
    expect(body).not.toContain('"tenant_id"');
  });
});

// ---------------------------------------------------------------------------
// AC9 — fixture coverage: agent, manager and portal principals across tenants
// ---------------------------------------------------------------------------

describe('AC9: principal fixtures for offline test execution', () => {
  it('agent principal has ticket:create and ticket:read permissions', () => {
    const p = makeAgentPrincipal();
    expect(p.permissions).toContain('ticket:create');
    expect(p.permissions).toContain('ticket:read');
    expect(p.principalKind).toBe('staff');
  });

  it('admin principal has all required ticket permissions', () => {
    const p = makeAdminPrincipal();
    expect(p.permissions).toContain('ticket:create');
    expect(p.permissions).toContain('ticket:read');
    expect(p.permissions).toContain('ticket:update');
    expect(p.roles).toContain('admin');
  });

  it('portal principal is bound to a specific organisation', () => {
    const p = makePortalPrincipal(TENANT_A, ORG_A_ID);
    expect(p.principalKind).toBe('portal');
    expect((p as { boundOrganizationId?: string }).boundOrganizationId).toBe(ORG_A_ID);
    expect(p.tenantId).toBe(TENANT_A);
  });

  it('tenant B principal has a different tenantId than tenant A', () => {
    const pA = makeAdminPrincipal(TENANT_A);
    const pB = makeAdminPrincipal(TENANT_B);
    expect(pA.tenantId).not.toBe(pB.tenantId);
  });
});
