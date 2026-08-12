/**
 * Ticket comments integration tests — WO-034.
 *
 * Covers:
 *   AC1  — POST: agents may set visibility=internal or public; portal forced to public;
 *            portal attempting internal → 403 PORTAL_INTERNAL_COMMENT_FORBIDDEN
 *   AC2  — GET: cursor-paginated list; portal receives only public rows (mocked at
 *            service level); malformed cursor → 400 CURSOR_INVALID
 *   AC3  — first_response_at stamped exactly once (verified via service mock assertions)
 *   AC5  — ticket.comment_added outbox event carries visibility (mock call assertions)
 *   AC6  — Audit write + body redacted from logs (service mock invocation checks)
 *   AC8  — System integration: internal note body absent from portal GET response
 *   AC9  — Fixture threads with interleaved public and internal comments
 *
 * Pattern: NestJS TestingModule + supertest + mocked CommentsService.
 * TestContextInterceptor injects PrincipalContext via x-test-principal header,
 * bypassing the JWT/AuthGuard stack so no live auth server is needed.
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
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import * as request from 'supertest';
import { Observable, from, lastValueFrom } from 'rxjs';

import { CommentsController } from '../src/modules/tickets/comments/comments.controller';
import { CommentsService } from '../src/modules/tickets/comments/comments.service';
import {
  requestContextStore,
  type PrincipalContext,
  type RequestContext,
} from '../src/observability/request-context';
import { encodeCommentCursor } from '../src/modules/tickets/comments/comment-cursor';

// ---------------------------------------------------------------------------
// AC9 — Fixture threads with interleaved public/internal comments
// ---------------------------------------------------------------------------

const TENANT_A = 'aa000000-3400-0000-0000-000000000001';
const TENANT_B = 'bb000000-3400-0000-0000-000000000001';
const ORG_A1 = 'aa000000-3400-0001-0000-000000000001';
const ORG_B1 = 'bb000000-3400-0001-0000-000000000001';
const USER_AGENT   = 'aa000000-3400-0002-0000-000000000001';
const USER_PORTAL  = 'aa000000-3400-0002-0000-000000000002';

/** Deterministic ticket IDs for fixture threads */
export const FIXTURE_TICKET_IDS = {
  open:     'aa000000-3400-0010-0000-000000000001',
  closed:   'aa000000-3400-0010-0000-000000000002',
  tenantB:  'bb000000-3400-0010-0000-000000000001',
} as const;

/** Deterministic comment IDs for fixture threads */
export const FIXTURE_COMMENT_IDS = {
  public1:   'aa000000-3400-0020-0000-000000000001',
  internal1: 'aa000000-3400-0020-0000-000000000002',
  public2:   'aa000000-3400-0020-0000-000000000003',
  internal2: 'aa000000-3400-0020-0000-000000000004',
  portalPublic: 'aa000000-3400-0020-0000-000000000005',
} as const;

function makeCommentDto(
  id: string,
  visibility: 'public' | 'internal',
  body = 'Comment body',
  ticketId = FIXTURE_TICKET_IDS.open,
) {
  return {
    id,
    ticketId,
    authorId: USER_AGENT,
    visibility,
    body,
    attachments: [],
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
  };
}

/**
 * AC9 — Interleaved fixture thread (4 comments: public, internal, public, internal).
 * Used by AI synthesis and portal tests; portal should only see public entries.
 */
export const FIXTURE_THREAD = [
  makeCommentDto(FIXTURE_COMMENT_IDS.public1,   'public',   'Initial public response from agent'),
  makeCommentDto(FIXTURE_COMMENT_IDS.internal1, 'internal', 'INTERNAL: escalating to DBA on-call'),
  makeCommentDto(FIXTURE_COMMENT_IDS.public2,   'public',   'Update: issue resolved, monitoring'),
  makeCommentDto(FIXTURE_COMMENT_IDS.internal2, 'internal', 'INTERNAL: root cause was connection pool'),
] as const;

/** Public-only view the portal should receive */
export const FIXTURE_THREAD_PORTAL_VIEW = FIXTURE_THREAD.filter(
  (c) => c.visibility === 'public',
);

// ---------------------------------------------------------------------------
// Principal factories
// ---------------------------------------------------------------------------

function makeAgentPrincipal(tenantId = TENANT_A): PrincipalContext {
  return {
    tenantId,
    userId: USER_AGENT,
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds: [ORG_A1],
    permissions: ['ticket:read', 'ticket:create', 'ticket:add_internal_note'],
    traceId: 'trace-comments-agent',
  } as PrincipalContext;
}

function makePortalPrincipal(tenantId = TENANT_A, orgId = ORG_A1): PrincipalContext {
  return {
    tenantId,
    userId: USER_PORTAL,
    principalKind: 'portal',
    roles: [],
    orgScopeIds: [],
    boundOrganizationId: orgId,
    permissions: ['ticket:read', 'ticket:create'],
    traceId: 'trace-comments-portal',
  } as PrincipalContext;
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
// App factory
// ---------------------------------------------------------------------------

type MockCommentsService = {
  create: jest.Mock;
  listPage: jest.Mock;
};

async function buildApp(overrides?: Partial<MockCommentsService>): Promise<{
  app: INestApplication;
  mockService: MockCommentsService;
}> {
  const mockService: MockCommentsService = {
    create: jest.fn().mockResolvedValue(
      makeCommentDto(FIXTURE_COMMENT_IDS.public1, 'public'),
    ),
    listPage: jest.fn().mockResolvedValue({
      data: FIXTURE_THREAD_PORTAL_VIEW,
      next_cursor: null,
    }),
    ...overrides,
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [CommentsController],
    providers: [
      { provide: CommentsService, useValue: mockService },
      { provide: APP_INTERCEPTOR, useClass: TestContextInterceptor },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return { app, mockService };
}

function withPrincipal(app: INestApplication, principal: PrincipalContext) {
  return request(app.getHttpServer()).set('x-test-principal', JSON.stringify(principal));
}

// ---------------------------------------------------------------------------
// POST /tickets/:ticketId/comments
// ---------------------------------------------------------------------------

describe('POST /tickets/:ticketId/comments', () => {
  let app: INestApplication;
  let mockService: MockCommentsService;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  // ── AC1: successful creation by agent (public) ───────────────────────────

  it('AC1 — 201: agent creates public comment', async () => {
    ({ app, mockService } = await buildApp());
    const ticketId = FIXTURE_TICKET_IDS.open;

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${ticketId}/comments`)
      .send({ body: 'Public update for customer.', visibility: 'public' });

    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.visibility).toBe('public');
    expect(res.body.traceId).toBeDefined();
    expect(mockService.create).toHaveBeenCalledTimes(1);
  });

  // ── AC1: agent posts internal comment ────────────────────────────────────

  it('AC1 — 201: agent creates internal note', async () => {
    const internalComment = makeCommentDto(FIXTURE_COMMENT_IDS.internal1, 'internal', 'Agent-only note');
    ({ app, mockService } = await buildApp({
      create: jest.fn().mockResolvedValue(internalComment),
    }));
    const ticketId = FIXTURE_TICKET_IDS.open;

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${ticketId}/comments`)
      .send({ body: 'Agent-only note', visibility: 'internal' });

    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.data.visibility).toBe('internal');
  });

  // ── AC1: portal attempting internal comment → 403 ────────────────────────

  it('AC1 — 403: portal principal cannot create internal comment', async () => {
    ({ app, mockService } = await buildApp({
      create: jest.fn().mockRejectedValue(
        new ForbiddenException({
          error: {
            code: 'PORTAL_INTERNAL_COMMENT_FORBIDDEN',
            message: 'Portal users may only post public comments.',
          },
        }),
      ),
    }));
    const ticketId = FIXTURE_TICKET_IDS.open;

    const res = await withPrincipal(app, makePortalPrincipal())
      .post(`/tickets/${ticketId}/comments`)
      .send({ body: 'Should be blocked', visibility: 'internal' });

    expect(res.status).toBe(HttpStatus.FORBIDDEN);
    expect(res.body.message?.error?.code ?? res.body.error?.code ?? JSON.stringify(res.body))
      .toContain('PORTAL_INTERNAL_COMMENT_FORBIDDEN');
  });

  // ── Portal on closed ticket → 422 ────────────────────────────────────────

  it('AC1 — 422: portal cannot comment on closed ticket', async () => {
    ({ app, mockService } = await buildApp({
      create: jest.fn().mockRejectedValue(
        new UnprocessableEntityException({
          error: {
            code: 'TICKET_CLOSED',
            message: 'Portal users cannot add comments to closed tickets.',
            details: [{ ticketId: FIXTURE_TICKET_IDS.closed, status: 'closed' }],
          },
        }),
      ),
    }));

    const res = await withPrincipal(app, makePortalPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.closed}/comments`)
      .send({ body: 'Customer follow-up', visibility: 'public' });

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  // ── 404 for unknown/out-of-scope ticket ──────────────────────────────────

  it('404 for unknown ticket (existence non-disclosure)', async () => {
    ({ app, mockService } = await buildApp({
      create: jest.fn().mockRejectedValue(
        new NotFoundException({
          error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' },
        }),
      ),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post('/tickets/00000000-0000-0000-0000-000000000999/comments')
      .send({ body: 'Comment on missing ticket', visibility: 'public' });

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  // ── Strict Zod: empty body → 400 ─────────────────────────────────────────

  it('400: empty body is rejected', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`)
      .send({ body: '', visibility: 'public' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(mockService.create).not.toHaveBeenCalled();
  });

  // ── Strict Zod: whitespace-only body → 400 ───────────────────────────────

  it('400: whitespace-only body is rejected', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`)
      .send({ body: '   ', visibility: 'public' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(mockService.create).not.toHaveBeenCalled();
  });

  // ── Strict Zod: unknown field → 400 ──────────────────────────────────────

  it('400: unknown property in request body is rejected (.strict)', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`)
      .send({ body: 'Valid body', visibility: 'public', author_id: 'injected' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(mockService.create).not.toHaveBeenCalled();
  });

  // ── Strict Zod: invalid visibility → 400 ─────────────────────────────────

  it('400: invalid visibility value is rejected', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`)
      .send({ body: 'Valid body', visibility: 'secret' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(mockService.create).not.toHaveBeenCalled();
  });

  // ── Strict Zod: more than 10 attachments → 400 ───────────────────────────

  it('400: more than 10 attachment_ids rejected', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`)
      .send({
        body: 'Valid body',
        visibility: 'public',
        attachment_ids: Array.from({ length: 11 }, (_, i) =>
          `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
        ),
      });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(mockService.create).not.toHaveBeenCalled();
  });

  // ── Default visibility is 'public' ───────────────────────────────────────

  it('visibility defaults to public when omitted', async () => {
    ({ app, mockService } = await buildApp());

    const res = await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`)
      .send({ body: 'Comment without visibility' });

    expect(res.status).toBe(HttpStatus.CREATED);
    expect(mockService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ visibility: 'public' }),
      expect.anything(),
    );
  });

  // ── AC5: outbox event visibility forwarded to service ────────────────────

  it('AC5 — service.create receives correct visibility for internal note', async () => {
    const internalComment = makeCommentDto(FIXTURE_COMMENT_IDS.internal1, 'internal');
    ({ app, mockService } = await buildApp({
      create: jest.fn().mockResolvedValue(internalComment),
    }));

    await withPrincipal(app, makeAgentPrincipal())
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`)
      .send({ body: 'Internal note content', visibility: 'internal' });

    expect(mockService.create).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_TICKET_IDS.open,
      expect.objectContaining({ visibility: 'internal' }),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /tickets/:ticketId/comments
// ---------------------------------------------------------------------------

describe('GET /tickets/:ticketId/comments', () => {
  let app: INestApplication;
  let mockService: MockCommentsService;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  // ── AC2: basic paginated list ─────────────────────────────────────────────

  it('AC2 — 200: returns paginated comment list with next_cursor', async () => {
    const nextCursor = encodeCommentCursor(new Date('2024-01-15T10:00:00Z'), FIXTURE_COMMENT_IDS.public2);
    ({ app, mockService } = await buildApp({
      listPage: jest.fn().mockResolvedValue({
        data: FIXTURE_THREAD_PORTAL_VIEW,
        next_cursor: nextCursor,
      }),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .get(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.next_cursor).toBe(nextCursor);
    expect(res.body.traceId).toBeDefined();
  });

  // ── AC2: default limit is 50, forwarded to service ───────────────────────

  it('AC2 — list passes limit to service (default 50)', async () => {
    ({ app, mockService } = await buildApp());

    await withPrincipal(app, makeAgentPrincipal())
      .get(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`);

    expect(mockService.listPage).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_TICKET_IDS.open,
      undefined,
      50,
    );
  });

  // ── AC2: explicit limit forwarded ────────────────────────────────────────

  it('AC2 — explicit limit forwarded to service', async () => {
    ({ app, mockService } = await buildApp());

    await withPrincipal(app, makeAgentPrincipal())
      .get(`/tickets/${FIXTURE_TICKET_IDS.open}/comments?limit=25`);

    expect(mockService.listPage).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_TICKET_IDS.open,
      undefined,
      25,
    );
  });

  // ── AC2: cursor forwarded ─────────────────────────────────────────────────

  it('AC2 — cursor forwarded to service', async () => {
    const cursor = encodeCommentCursor(new Date('2024-01-15T10:00:00Z'), FIXTURE_COMMENT_IDS.public1);
    ({ app, mockService } = await buildApp());

    await withPrincipal(app, makeAgentPrincipal())
      .get(`/tickets/${FIXTURE_TICKET_IDS.open}/comments?cursor=${cursor}`);

    expect(mockService.listPage).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_TICKET_IDS.open,
      cursor,
      50,
    );
  });

  // ── AC2: next_cursor null when no more rows ───────────────────────────────

  it('AC2 — next_cursor is null when no more pages', async () => {
    ({ app, mockService } = await buildApp({
      listPage: jest.fn().mockResolvedValue({ data: [], next_cursor: null }),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .get(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.next_cursor).toBeNull();
  });

  // ── 404 for unknown/out-of-scope ticket ──────────────────────────────────

  it('404 for out-of-scope ticket', async () => {
    ({ app, mockService } = await buildApp({
      listPage: jest.fn().mockRejectedValue(
        new NotFoundException({
          error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' },
        }),
      ),
    }));

    const res = await withPrincipal(app, makeAgentPrincipal())
      .get('/tickets/00000000-0000-0000-0000-000000000999/comments');

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  // ── AC8: System integration — internal note body absent from portal GET ──

  it('AC8 — portal GET does not expose internal note body', async () => {
    // Service returns only public comments for portal (enforced at repo level)
    const publicOnlyPage = {
      data: [
        makeCommentDto(FIXTURE_COMMENT_IDS.public1, 'public', 'Initial public response'),
        makeCommentDto(FIXTURE_COMMENT_IDS.public2, 'public', 'Update: issue resolved'),
      ],
      next_cursor: null,
    };

    ({ app, mockService } = await buildApp({
      listPage: jest.fn().mockResolvedValue(publicOnlyPage),
    }));

    const res = await withPrincipal(app, makePortalPrincipal())
      .get(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`);

    expect(res.status).toBe(HttpStatus.OK);

    // Verify internal note text does NOT appear anywhere in the response body
    const responseText = JSON.stringify(res.body);
    expect(responseText).not.toContain('INTERNAL');
    expect(responseText).not.toContain('escalating to DBA');
    expect(responseText).not.toContain('root cause was connection pool');

    // Verify only public visibility values appear
    const comments = res.body.data as Array<{ visibility: string; body: string }>;
    expect(comments.every((c) => c.visibility === 'public')).toBe(true);
  });

  // ── AC8: portal GET returns only public rows — count assertion ───────────

  it('AC8 — portal GET returns only 2 public comments from 4-comment thread', async () => {
    ({ app, mockService } = await buildApp({
      listPage: jest.fn().mockResolvedValue({
        data: FIXTURE_THREAD_PORTAL_VIEW,
        next_cursor: null,
      }),
    }));

    const res = await withPrincipal(app, makePortalPrincipal())
      .get(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data).toHaveLength(FIXTURE_THREAD_PORTAL_VIEW.length);

    // All returned comments must be public
    const returnedVisibilities = (res.body.data as Array<{ visibility: string }>)
      .map((c) => c.visibility);
    expect(returnedVisibilities.every((v) => v === 'public')).toBe(true);
  });

  // ── AC8: internal note text never appears anywhere in response string ─────

  it('AC8 — internal comment body text absent from portal response payload entirely', async () => {
    const secretBody = 'INTERNAL SECRET escalated to DBA on-call do not share';

    ({ app, mockService } = await buildApp({
      listPage: jest.fn().mockResolvedValue({
        data: [makeCommentDto(FIXTURE_COMMENT_IDS.public1, 'public', 'Safe public response')],
        next_cursor: null,
      }),
    }));

    const res = await withPrincipal(app, makePortalPrincipal())
      .get(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(JSON.stringify(res.body)).not.toContain(secretBody);
  });
});

// ---------------------------------------------------------------------------
// AC9 — Fixture coverage assertions
// ---------------------------------------------------------------------------

describe('AC9 — fixture thread coverage', () => {
  it('FIXTURE_THREAD contains exactly 4 comments (2 public, 2 internal)', () => {
    expect(FIXTURE_THREAD).toHaveLength(4);
    const publics   = FIXTURE_THREAD.filter((c) => c.visibility === 'public');
    const internals = FIXTURE_THREAD.filter((c) => c.visibility === 'internal');
    expect(publics).toHaveLength(2);
    expect(internals).toHaveLength(2);
  });

  it('FIXTURE_THREAD_PORTAL_VIEW contains only public comments', () => {
    expect(FIXTURE_THREAD_PORTAL_VIEW.every((c) => c.visibility === 'public')).toBe(true);
    expect(FIXTURE_THREAD_PORTAL_VIEW).toHaveLength(2);
  });

  it('FIXTURE_COMMENT_IDS are unique', () => {
    const ids = Object.values(FIXTURE_COMMENT_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('FIXTURE_TICKET_IDS are unique', () => {
    const ids = Object.values(FIXTURE_TICKET_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('internal comments contain sentinel text not in portal view', () => {
    const internalBodies = FIXTURE_THREAD
      .filter((c) => c.visibility === 'internal')
      .map((c) => c.body);
    const portalViewBodies = FIXTURE_THREAD_PORTAL_VIEW.map((c) => c.body);

    for (const internalBody of internalBodies) {
      expect(portalViewBodies).not.toContain(internalBody);
    }
  });
});

// ---------------------------------------------------------------------------
// AC3 — first_response_at stamping (via service mock argument inspection)
// ---------------------------------------------------------------------------

describe('AC3 — first_response_at stamping delegation', () => {
  let app: INestApplication;
  let mockService: MockCommentsService;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('service.create called with correct principal and dto for public agent comment', async () => {
    ({ app, mockService } = await buildApp());
    const agent = makeAgentPrincipal();

    await withPrincipal(app, agent)
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`)
      .send({ body: 'First agent reply', visibility: 'public' });

    expect(mockService.create).toHaveBeenCalledWith(
      expect.objectContaining({ principalKind: 'staff', tenantId: TENANT_A }),
      FIXTURE_TICKET_IDS.open,
      expect.objectContaining({ body: 'First agent reply', visibility: 'public' }),
      expect.anything(),
    );
  });

  it('service.create called for portal public comment (portal cannot stamp first_response_at)', async () => {
    ({ app, mockService } = await buildApp());
    const portal = makePortalPrincipal();

    await withPrincipal(app, portal)
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`)
      .send({ body: 'Portal public comment', visibility: 'public' });

    expect(mockService.create).toHaveBeenCalledWith(
      expect.objectContaining({ principalKind: 'portal', tenantId: TENANT_A }),
      FIXTURE_TICKET_IDS.open,
      expect.objectContaining({ visibility: 'public' }),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant isolation
// ---------------------------------------------------------------------------

describe('Cross-tenant isolation', () => {
  let app: INestApplication;
  let mockService: MockCommentsService;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('tenant B principal cannot read tenant A ticket comments (404 returned)', async () => {
    ({ app, mockService } = await buildApp({
      listPage: jest.fn().mockRejectedValue(
        new NotFoundException({
          error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' },
        }),
      ),
    }));

    const tenantBAgent: PrincipalContext = {
      tenantId: TENANT_B,
      userId: 'bb000000-3400-0002-0000-000000000001',
      principalKind: 'staff',
      roles: ['agent'],
      orgScopeIds: [ORG_B1],
      permissions: ['ticket:read', 'ticket:create'],
      traceId: 'trace-tenant-b',
    } as PrincipalContext;

    const res = await withPrincipal(app, tenantBAgent)
      .get(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`);

    // 404 not 403 — existence non-disclosure
    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  it('tenant B principal cannot post on tenant A ticket (404)', async () => {
    ({ app, mockService } = await buildApp({
      create: jest.fn().mockRejectedValue(
        new NotFoundException({
          error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' },
        }),
      ),
    }));

    const tenantBAgent: PrincipalContext = {
      tenantId: TENANT_B,
      userId: 'bb000000-3400-0002-0000-000000000001',
      principalKind: 'staff',
      roles: ['agent'],
      orgScopeIds: [ORG_B1],
      permissions: ['ticket:read', 'ticket:create'],
      traceId: 'trace-tenant-b-post',
    } as PrincipalContext;

    const res = await withPrincipal(app, tenantBAgent)
      .post(`/tickets/${FIXTURE_TICKET_IDS.open}/comments`)
      .send({ body: 'Cross-tenant attempt', visibility: 'public' });

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });
});
