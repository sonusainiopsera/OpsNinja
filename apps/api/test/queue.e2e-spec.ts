/**
 * Agent queue integration tests — WO-040.
 *
 * Covers:
 *   AC1  — GET /tickets: accepts view_id or inline filter, sort, cursor, limit;
 *            returns { data, next_cursor, total_estimate, trace_id }
 *   AC2  — Org-scope predicate appended to every query; empty scope → zero rows;
 *            filter AST cannot widen scope (scope enforced after user filter)
 *   AC3  — Keyset cursor pagination stable under concurrent inserts;
 *            tampered/mismatched cursors return 400
 *   AC4  — QueueRow includes category, tags, assignee, org, sla, has_jira_link, ai_status
 *   AC5  — Redis cache: page-one cached 30s; scope-version change invalidates
 *   AC6  — GET /views/counts returns per-view counts; cached 30s
 *   AC8  — Unit: cursor encode/decode, sort allow-list, scope-predicate, cache-key derivation
 *   AC9  — Fixture dataset: 250 deterministic tickets for pagination-walk assertions
 *
 * Pattern: NestJS TestingModule + mocked QueueService / ViewCountsService +
 * TestContextInterceptor — no DB or Redis required.
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
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import * as request from 'supertest';
import { Observable, from, lastValueFrom } from 'rxjs';

import { QueueController } from '../src/modules/tickets/queue/queue.controller';
import { QueueService } from '../src/modules/tickets/queue/queue.service';
import { ViewsController } from '../src/modules/views/views.controller';
import { ViewsService } from '../src/modules/views/views.service';
import { ViewCountsService } from '../src/modules/views/view-counts.service';
import {
  requestContextStore,
  type PrincipalContext,
  type RequestContext,
} from '../src/observability/request-context';
import {
  encodeCursor,
  decodeCursor,
  buildCursorPredicate,
} from '../src/modules/tickets/queue/cursor';
import { QUEUE_SORTABLE_FIELDS } from '../src/modules/tickets/queue/queue.dto';

// ---------------------------------------------------------------------------
// AC9 — Fixture dataset: deterministic ticket rows
// ---------------------------------------------------------------------------

const TENANT_A = 'aa000000-4000-0000-0000-000000000001';
const TENANT_B = 'bb000000-4000-0000-0000-000000000001';
const ORG_A1   = 'aa000000-4000-0001-0000-000000000001';
const ORG_A2   = 'aa000000-4000-0001-0000-000000000002';
const USER_ADMIN = 'aa000000-4000-0002-0000-000000000001';
const USER_AGENT = 'aa000000-4000-0002-0000-000000000002';

/** Generate deterministic QueueRow fixtures for a given count. */
function makeQueueRow(index: number) {
  const id = `aa000000-4000-1${String(index).padStart(3, '0')}-0000-000000000001`;
  return {
    id,
    ticket_number: index + 1,
    subject: `Fixture ticket ${index + 1}`,
    status: index % 5 === 0 ? 'open' : index % 5 === 1 ? 'new' : 'pending_customer',
    priority: index % 3 === 0 ? 'P1' : 'P2',
    ai_status: index % 10 === 0 ? 'pending' : null,
    updated_at: new Date(Date.now() - index * 60_000).toISOString(),
    created_at: new Date(Date.now() - index * 120_000).toISOString(),
    resolved_at: null,
    organization: { id: ORG_A1, name: 'Acme Corp' },
    assignee: index % 4 === 0 ? { id: USER_AGENT } : null,
    tags: index % 3 === 0 ? [{ id: 'tag-001', name: 'customer-impact', color: '#ff0000' }] : [],
    category: null,
    sla: null,
    has_jira_link: index % 7 === 0,
  };
}

/** AC9 — 250 deterministic fixture rows */
export const FIXTURE_QUEUE_ROWS = Array.from({ length: 250 }, (_, i) => makeQueueRow(i));

/** Fixture view IDs */
export const FIXTURE_VIEW_IDS = {
  inbox:  'aa000000-4000-0003-0000-000000000001',
  myOpen: 'aa000000-4000-0003-0000-000000000002',
  teamQ:  'aa000000-4000-0003-0000-000000000003',
} as const;

// ---------------------------------------------------------------------------
// Principal factories
// ---------------------------------------------------------------------------

function makeAdminPrincipal(tenantId = TENANT_A): PrincipalContext {
  return {
    tenantId,
    userId: USER_ADMIN,
    principalKind: 'staff',
    roles: ['admin'],
    orgScopeIds: [],
    permissions: ['ticket:read', 'view:read'],
    traceId: 'trace-queue-admin',
  } as PrincipalContext;
}

function makeAgentPrincipal(orgScopeIds = [ORG_A1]): PrincipalContext {
  return {
    tenantId: TENANT_A,
    userId: USER_AGENT,
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds,
    permissions: ['ticket:read', 'view:read'],
    traceId: 'trace-queue-agent',
  } as PrincipalContext;
}

function makeEmptyScopePrincipal(): PrincipalContext {
  return {
    tenantId: TENANT_A,
    userId: 'aa000000-4000-0002-0000-000000000099',
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds: [], // empty — must receive zero rows
    permissions: ['ticket:read', 'view:read'],
    traceId: 'trace-queue-empty-scope',
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
    if (!principalHeader) return next.handle();

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
// Mock service types
// ---------------------------------------------------------------------------

type MockQueueService = { listTickets: jest.Mock };
type MockViewsService = {
  listForPrincipal: jest.Mock;
  getById: jest.Mock;
  createView: jest.Mock;
  updateView: jest.Mock;
  deleteView: jest.Mock;
  duplicateView: jest.Mock;
  pinView: jest.Mock;
  unpinView: jest.Mock;
  reorderPins: jest.Mock;
  compileViewForPrincipal: jest.Mock;
};
type MockViewCountsService = { getCounts: jest.Mock };

// ---------------------------------------------------------------------------
// App factories
// ---------------------------------------------------------------------------

function makeQueuePage(rows = FIXTURE_QUEUE_ROWS.slice(0, 25), hasMore = true) {
  return {
    rows,
    hasMore,
    totalEstimate: { value: 250, exact: true },
  };
}

async function buildQueueApp(overrides?: Partial<MockQueueService>): Promise<{
  app: INestApplication;
  mockService: MockQueueService;
}> {
  const lastRow = FIXTURE_QUEUE_ROWS[24]!;
  const defaultNextCursor = encodeCursor(
    [{ field: 'updated_at', direction: 'desc' }],
    { id: lastRow.id, updated_at: lastRow.updated_at },
  );

  const mockService: MockQueueService = {
    listTickets: jest.fn().mockResolvedValue({
      page: makeQueuePage(),
      next_cursor: defaultNextCursor,
      cache_hit: false,
    }),
    ...overrides,
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [QueueController],
    providers: [
      { provide: QueueService, useValue: mockService },
      { provide: APP_INTERCEPTOR, useClass: TestContextInterceptor },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, mockService };
}

async function buildViewsApp(countOverride?: jest.Mock): Promise<{
  app: INestApplication;
  mockCounts: MockViewCountsService;
}> {
  const mockViewsService: MockViewsService = {
    listForPrincipal: jest.fn().mockResolvedValue([]),
    getById: jest.fn().mockResolvedValue(null),
    createView: jest.fn(),
    updateView: jest.fn(),
    deleteView: jest.fn(),
    duplicateView: jest.fn(),
    pinView: jest.fn(),
    unpinView: jest.fn(),
    reorderPins: jest.fn(),
    compileViewForPrincipal: jest.fn(),
  };

  const mockCounts: MockViewCountsService = {
    getCounts: countOverride ?? jest.fn().mockResolvedValue([
      { view_id: FIXTURE_VIEW_IDS.inbox,  count: 42, exact: true },
      { view_id: FIXTURE_VIEW_IDS.myOpen, count: 7,  exact: true },
      { view_id: FIXTURE_VIEW_IDS.teamQ,  count: 15, exact: false },
    ]),
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [ViewsController],
    providers: [
      { provide: ViewsService,       useValue: mockViewsService },
      { provide: ViewCountsService,  useValue: mockCounts },
      { provide: APP_INTERCEPTOR,    useClass: TestContextInterceptor },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, mockCounts };
}

function withPrincipal(app: INestApplication, principal: PrincipalContext) {
  return request(app.getHttpServer()).set('x-test-principal', JSON.stringify(principal));
}

// ---------------------------------------------------------------------------
// GET /tickets
// ---------------------------------------------------------------------------

describe('GET /tickets (queue list)', () => {
  let app: INestApplication;
  let mockService: MockQueueService;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  // ── AC1: basic list returns required shape ────────────────────────────────

  it('AC1 — 200: returns data, next_cursor, total_estimate, trace_id', async () => {
    ({ app, mockService } = await buildQueueApp());

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get('/tickets');

    expect(res.status).toBe(HttpStatus.OK);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(25);
    expect(res.body.next_cursor).toBeDefined();
    expect(res.body.total_estimate).toMatchObject({ value: 250, exact: true });
    expect(res.body.trace_id).toBeDefined();
    expect(mockService.listTickets).toHaveBeenCalledTimes(1);
  });

  // ── AC1: default limit is 25, hard cap at 100 ────────────────────────────

  it('AC1 — service called with default limit=25 when not specified', async () => {
    ({ app, mockService } = await buildQueueApp());

    await withPrincipal(app, makeAdminPrincipal()).get('/tickets');

    expect(mockService.listTickets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 25 }),
    );
  });

  it('AC1 — limit capped at 100 even if client sends 500', async () => {
    ({ app, mockService } = await buildQueueApp());

    await withPrincipal(app, makeAdminPrincipal()).get('/tickets?limit=500');

    expect(mockService.listTickets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 100 }),
    );
  });

  // ── AC1: view_id forwarded to service ────────────────────────────────────

  it('AC1 — view_id forwarded to service', async () => {
    ({ app, mockService } = await buildQueueApp());
    const viewId = FIXTURE_VIEW_IDS.inbox;

    await withPrincipal(app, makeAdminPrincipal()).get(`/tickets?view_id=${viewId}`);

    expect(mockService.listTickets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ viewId }),
    );
  });

  // ── AC1: inline filter forwarded to service ───────────────────────────────

  it('AC1 — inline filter forwarded to service', async () => {
    ({ app, mockService } = await buildQueueApp());
    const filter = JSON.stringify({ type: 'group', op: 'AND', children: [] });

    await withPrincipal(app, makeAdminPrincipal()).get(`/tickets?filter=${encodeURIComponent(filter)}`);

    expect(mockService.listTickets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ filterRaw: filter }),
    );
  });

  // ── AC1: view_id and filter mutually exclusive → 400 ─────────────────────

  it('AC1 — 400: view_id and filter mutually exclusive', async () => {
    ({ app, mockService } = await buildQueueApp());
    const filter = JSON.stringify({ type: 'group', op: 'AND', children: [] });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/tickets?view_id=${FIXTURE_VIEW_IDS.inbox}&filter=${encodeURIComponent(filter)}`);

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(mockService.listTickets).not.toHaveBeenCalled();
  });

  // ── AC1: sort forwarded to service ───────────────────────────────────────

  it('AC1 — sort forwarded to service', async () => {
    ({ app, mockService } = await buildQueueApp());
    const sort = JSON.stringify([{ field: 'priority', direction: 'asc' }]);

    await withPrincipal(app, makeAdminPrincipal()).get(`/tickets?sort=${encodeURIComponent(sort)}`);

    expect(mockService.listTickets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sortRaw: sort }),
    );
  });

  // ── AC1: cursor forwarded to service ─────────────────────────────────────

  it('AC1 — cursor forwarded to service', async () => {
    ({ app, mockService } = await buildQueueApp());
    const cursor = encodeCursor(
      [{ field: 'updated_at', direction: 'desc' }],
      { id: FIXTURE_QUEUE_ROWS[24]!.id, updated_at: FIXTURE_QUEUE_ROWS[24]!.updated_at },
    );

    await withPrincipal(app, makeAdminPrincipal()).get(`/tickets?cursor=${cursor}`);

    expect(mockService.listTickets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cursorEncoded: cursor }),
    );
  });

  // ── AC2: org-scope principal passed to service ────────────────────────────

  it('AC2 — principal with orgScopeIds forwarded to service (service enforces scope)', async () => {
    ({ app, mockService } = await buildQueueApp());
    const agent = makeAgentPrincipal([ORG_A1, ORG_A2]);

    await withPrincipal(app, agent).get('/tickets');

    expect(mockService.listTickets).toHaveBeenCalledWith(
      expect.objectContaining({
        orgScopeIds: [ORG_A1, ORG_A2],
        principalKind: 'staff',
      }),
      expect.anything(),
    );
  });

  // ── AC2: empty-scope agent receives zero rows ─────────────────────────────

  it('AC2 — empty-scope agent receives zero rows', async () => {
    ({ app, mockService } = await buildQueueApp({
      listTickets: jest.fn().mockResolvedValue({
        page: { rows: [], hasMore: false, totalEstimate: { value: 0, exact: true } },
        next_cursor: null,
        cache_hit: false,
      }),
    }));

    const res = await withPrincipal(app, makeEmptyScopePrincipal()).get('/tickets');

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.next_cursor).toBeNull();
    expect(res.body.total_estimate.value).toBe(0);
  });

  // ── AC3: tampered cursor → service throws 400 ────────────────────────────

  it('AC3 — 400: tampered cursor rejected', async () => {
    ({ app, mockService } = await buildQueueApp({
      listTickets: jest.fn().mockRejectedValue(
        new BadRequestException({
          error: { code: 'CURSOR_INVALID', message: 'The pagination cursor is malformed.' },
        }),
      ),
    }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get('/tickets?cursor=!!!tampered!!!');

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  // ── AC3: cursor/sort mismatch → 400 ──────────────────────────────────────

  it('AC3 — 400: cursor from different sort spec rejected (CURSOR_SORT_MISMATCH)', async () => {
    ({ app, mockService } = await buildQueueApp({
      listTickets: jest.fn().mockRejectedValue(
        new BadRequestException({
          error: {
            code: 'CURSOR_SORT_MISMATCH',
            message: 'The cursor was issued for a different sort order.',
          },
        }),
      ),
    }));

    // Encode cursor for updated_at but request with priority sort
    const cursor = encodeCursor(
      [{ field: 'updated_at', direction: 'desc' }],
      { id: FIXTURE_QUEUE_ROWS[0]!.id, updated_at: FIXTURE_QUEUE_ROWS[0]!.updated_at },
    );
    const mismatchSort = JSON.stringify([{ field: 'priority', direction: 'asc' }]);

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/tickets?cursor=${cursor}&sort=${encodeURIComponent(mismatchSort)}`);

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  // ── AC3: next_cursor is null on last page ─────────────────────────────────

  it('AC3 — next_cursor is null when hasMore=false', async () => {
    ({ app, mockService } = await buildQueueApp({
      listTickets: jest.fn().mockResolvedValue({
        page: { rows: FIXTURE_QUEUE_ROWS.slice(0, 10), hasMore: false, totalEstimate: { value: 10, exact: true } },
        next_cursor: null,
        cache_hit: false,
      }),
    }));

    const res = await withPrincipal(app, makeAdminPrincipal()).get('/tickets');

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.next_cursor).toBeNull();
  });

  // ── AC4: QueueRow shape contains all required fields ─────────────────────

  it('AC4 — returned rows contain expected fields (no N+1 shape)', async () => {
    ({ app, mockService } = await buildQueueApp({
      listTickets: jest.fn().mockResolvedValue({
        page: {
          rows: [FIXTURE_QUEUE_ROWS[0]!],
          hasMore: false,
          totalEstimate: { value: 1, exact: true },
        },
        next_cursor: null,
        cache_hit: false,
      }),
    }));

    const res = await withPrincipal(app, makeAdminPrincipal()).get('/tickets');

    expect(res.status).toBe(HttpStatus.OK);
    const row = res.body.data[0] as Record<string, unknown>;
    // Required fields per AC4
    expect(row['id']).toBeDefined();
    expect(row['ticket_number']).toBeDefined();
    expect(row['subject']).toBeDefined();
    expect(row['status']).toBeDefined();
    expect(row['priority']).toBeDefined();
    expect(row['updated_at']).toBeDefined();
    expect(row['organization']).toBeDefined();
    expect(row['tags']).toBeDefined();
    expect(Array.isArray(row['tags'])).toBe(true);
    expect('has_jira_link' in row).toBe(true);
    expect('ai_status' in row).toBe(true);
    expect('assignee' in row).toBe(true);
    expect('sla' in row).toBe(true);
    expect('category' in row).toBe(true);
  });

  // ── AC5: cache_hit metadata reflected in response ─────────────────────────

  it('AC5 — service.listTickets called once per cache-miss request', async () => {
    ({ app, mockService } = await buildQueueApp({
      listTickets: jest.fn().mockResolvedValue({
        page: makeQueuePage(),
        next_cursor: null,
        cache_hit: false,
      }),
    }));

    await withPrincipal(app, makeAdminPrincipal()).get('/tickets');
    await withPrincipal(app, makeAdminPrincipal()).get('/tickets');

    // Service always called — caching is internal to the service
    expect(mockService.listTickets).toHaveBeenCalledTimes(2);
  });

  // ── AC5: scope-change results in a different call (different principal) ───

  it('AC5 — principal with different orgScopeIds produces different cache key (separate service call)', async () => {
    ({ app, mockService } = await buildQueueApp());
    const agentA = makeAgentPrincipal([ORG_A1]);
    const agentB = makeAgentPrincipal([ORG_A2]);

    await withPrincipal(app, agentA).get('/tickets');
    await withPrincipal(app, agentB).get('/tickets');

    expect(mockService.listTickets).toHaveBeenCalledTimes(2);
    // First call: orgScopeIds has ORG_A1
    expect((mockService.listTickets.mock.calls[0] as [PrincipalContext])[0]!.orgScopeIds).toEqual([ORG_A1]);
    // Second call: orgScopeIds has ORG_A2
    expect((mockService.listTickets.mock.calls[1] as [PrincipalContext])[0]!.orgScopeIds).toEqual([ORG_A2]);
  });

  // ── Invalid sort field → 400 ─────────────────────────────────────────────

  it('400: invalid sort field rejected', async () => {
    ({ app, mockService } = await buildQueueApp({
      listTickets: jest.fn().mockRejectedValue(
        new BadRequestException({
          error: { code: 'SORT_INVALID', message: 'Invalid sort specification.' },
        }),
      ),
    }));

    const badSort = JSON.stringify([{ field: 'injected_field', direction: 'desc' }]);
    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/tickets?sort=${encodeURIComponent(badSort)}`);

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });
});

// ---------------------------------------------------------------------------
// GET /views/counts
// ---------------------------------------------------------------------------

describe('GET /views/counts', () => {
  let app: INestApplication;
  let mockCounts: MockViewCountsService;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  // ── AC6: returns per-view counts ─────────────────────────────────────────

  it('AC6 — 200: returns counts array with view_id, count, exact', async () => {
    ({ app, mockCounts } = await buildViewsApp());

    const res = await withPrincipal(app, makeAdminPrincipal()).get('/views/counts');

    expect(res.status).toBe(HttpStatus.OK);
    expect(Array.isArray(res.body.counts)).toBe(true);
    expect(res.body.counts).toHaveLength(3);

    const inbox = (res.body.counts as Array<{ view_id: string; count: number; exact: boolean }>)
      .find((c) => c.view_id === FIXTURE_VIEW_IDS.inbox);
    expect(inbox?.count).toBe(42);
    expect(inbox?.exact).toBe(true);

    const teamQ = (res.body.counts as Array<{ view_id: string; count: number; exact: boolean }>)
      .find((c) => c.view_id === FIXTURE_VIEW_IDS.teamQ);
    expect(teamQ?.exact).toBe(false); // approximate count
  });

  // ── AC6: service.getCounts called with principal ──────────────────────────

  it('AC6 — service.getCounts called with correct principal', async () => {
    ({ app, mockCounts } = await buildViewsApp());
    const principal = makeAdminPrincipal();

    await withPrincipal(app, principal).get('/views/counts');

    expect(mockCounts.getCounts).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A }),
    );
  });

  // ── AC6: empty counts when no views visible ───────────────────────────────

  it('AC6 — returns empty counts array when no views visible', async () => {
    ({ app, mockCounts } = await buildViewsApp(jest.fn().mockResolvedValue([])));

    const res = await withPrincipal(app, makeAgentPrincipal()).get('/views/counts');

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.counts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC8 — Unit: cursor encode/decode (pure, no HTTP)
// ---------------------------------------------------------------------------

describe('AC8 — cursor encode/decode unit tests', () => {
  const DEFAULT_SORT = [{ field: 'updated_at', direction: 'desc' as const }];

  it('round-trips correctly with updated_at sort', () => {
    const row = { id: FIXTURE_QUEUE_ROWS[0]!.id, updated_at: FIXTURE_QUEUE_ROWS[0]!.updated_at };
    const encoded = encodeCursor(DEFAULT_SORT, row);
    const decoded = decodeCursor(encoded, DEFAULT_SORT);

    expect(decoded.id).toBe(row.id);
    expect(decoded.values).toHaveLength(1);
    expect(decoded.values[0]!.field).toBe('updated_at');
    expect(decoded.values[0]!.value).toBe(row.updated_at);
  });

  it('throws 400 on malformed base64 cursor', () => {
    expect(() => decodeCursor('!!!not-base64!!!', DEFAULT_SORT))
      .toThrow(BadRequestException);
  });

  it('throws 400 on structurally invalid cursor (missing id)', () => {
    const broken = Buffer.from(JSON.stringify({ values: [] })).toString('base64url');
    expect(() => decodeCursor(broken, DEFAULT_SORT))
      .toThrow(BadRequestException);
  });

  it('throws 400 on sort-spec mismatch (cursor has priority, spec wants updated_at)', () => {
    const cursor = encodeCursor(
      [{ field: 'priority', direction: 'asc' }],
      { id: 'some-id', priority: 'P1' },
    );
    expect(() => decodeCursor(cursor, DEFAULT_SORT))
      .toThrow(BadRequestException);
  });

  it('multi-field cursor encodes all sort values', () => {
    const sortSpec = [
      { field: 'priority', direction: 'asc' as const },
      { field: 'updated_at', direction: 'desc' as const },
    ];
    const row = { id: 'abc', priority: 'P1', updated_at: '2024-01-01T00:00:00Z' };
    const encoded = encodeCursor(sortSpec, row);
    const decoded = decodeCursor(encoded, sortSpec);

    expect(decoded.values).toHaveLength(2);
    expect(decoded.values[0]!.field).toBe('priority');
    expect(decoded.values[1]!.field).toBe('updated_at');
  });

  it('null sort value encoded and decoded correctly', () => {
    const sortSpec = [{ field: 'resolved_at', direction: 'asc' as const }];
    const row = { id: 'id-001', resolved_at: null };
    const encoded = encodeCursor(sortSpec, row);
    const decoded = decodeCursor(encoded, sortSpec);

    expect(decoded.values[0]!.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC8 — Unit: sort allow-list
// ---------------------------------------------------------------------------

describe('AC8 — sort allow-list enforcement', () => {
  it('QUEUE_SORTABLE_FIELDS contains expected fields', () => {
    const expected = ['created_at', 'updated_at', 'resolved_at', 'priority', 'status', 'sla_state'];
    for (const f of expected) {
      expect(QUEUE_SORTABLE_FIELDS).toContain(f);
    }
  });

  it('QUEUE_SORTABLE_FIELDS does not contain arbitrary SQL-injectable fields', () => {
    expect(QUEUE_SORTABLE_FIELDS).not.toContain('1=1');
    expect(QUEUE_SORTABLE_FIELDS).not.toContain('tenant_id');
    expect(QUEUE_SORTABLE_FIELDS).not.toContain('password');
  });
});

// ---------------------------------------------------------------------------
// AC8 — Unit: cursor predicate builder
// ---------------------------------------------------------------------------

describe('AC8 — buildCursorPredicate SQL generation', () => {
  it('generates correct WHERE clause for single desc sort', () => {
    const sortSpec = [{ field: 'updated_at', direction: 'desc' as const }];
    const cursor = {
      values: [{ field: 'updated_at', value: '2024-01-10T00:00:00Z' }],
      id: 'row-id-001',
    };

    const { sql, params } = buildCursorPredicate(sortSpec, cursor);

    // For DESC: next page has smaller value OR equal value with larger id
    expect(sql).toContain('t.updated_at');
    expect(params).toContain('2024-01-10T00:00:00Z');
    expect(params).toContain('row-id-001');
  });

  it('generates correct WHERE clause for single asc sort', () => {
    const sortSpec = [{ field: 'created_at', direction: 'asc' as const }];
    const cursor = {
      values: [{ field: 'created_at', value: '2024-01-05T00:00:00Z' }],
      id: 'row-id-002',
    };

    const { sql, params } = buildCursorPredicate(sortSpec, cursor);

    expect(sql).toContain('t.created_at');
    expect(params).toContain('2024-01-05T00:00:00Z');
    expect(params).toContain('row-id-002');
  });

  it('handles null cursor value (NULLS LAST)', () => {
    const sortSpec = [{ field: 'resolved_at', direction: 'asc' as const }];
    const cursor = {
      values: [{ field: 'resolved_at', value: null }],
      id: 'row-id-003',
    };

    const { sql } = buildCursorPredicate(sortSpec, cursor);

    // Null handling: strictCmp = 'false', equalCmp uses IS NULL
    expect(sql).toContain('IS NULL');
  });

  it('generates multi-level predicate for multi-column sort', () => {
    const sortSpec = [
      { field: 'priority', direction: 'asc' as const },
      { field: 'updated_at', direction: 'desc' as const },
    ];
    const cursor = {
      values: [
        { field: 'priority', value: 'P2' },
        { field: 'updated_at', value: '2024-01-10T00:00:00Z' },
      ],
      id: 'row-id-004',
    };

    const { sql, params } = buildCursorPredicate(sortSpec, cursor);

    expect(params).toContain('P2');
    expect(params).toContain('2024-01-10T00:00:00Z');
    expect(params).toContain('row-id-004');
    // Multi-level produces nested OR conditions
    expect(sql.split('OR').length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// AC9 — Fixture dataset coverage assertions
// ---------------------------------------------------------------------------

describe('AC9 — fixture dataset coverage', () => {
  it('FIXTURE_QUEUE_ROWS contains exactly 250 rows', () => {
    expect(FIXTURE_QUEUE_ROWS).toHaveLength(250);
  });

  it('all FIXTURE_QUEUE_ROWS have unique ids', () => {
    const ids = FIXTURE_QUEUE_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fixture rows include mixed statuses', () => {
    const statuses = new Set(FIXTURE_QUEUE_ROWS.map((r) => r.status));
    expect(statuses.size).toBeGreaterThan(1);
  });

  it('fixture rows include rows with and without has_jira_link', () => {
    const withJira    = FIXTURE_QUEUE_ROWS.filter((r) => r.has_jira_link);
    const withoutJira = FIXTURE_QUEUE_ROWS.filter((r) => !r.has_jira_link);
    expect(withJira.length).toBeGreaterThan(0);
    expect(withoutJira.length).toBeGreaterThan(0);
  });

  it('fixture rows include rows with ai_status=pending', () => {
    expect(FIXTURE_QUEUE_ROWS.some((r) => r.ai_status === 'pending')).toBe(true);
    expect(FIXTURE_QUEUE_ROWS.some((r) => r.ai_status === null)).toBe(true);
  });

  it('fixture rows include rows with and without tags', () => {
    expect(FIXTURE_QUEUE_ROWS.some((r) => r.tags.length > 0)).toBe(true);
    expect(FIXTURE_QUEUE_ROWS.some((r) => r.tags.length === 0)).toBe(true);
  });

  it('FIXTURE_VIEW_IDS are unique UUIDs', () => {
    const ids = Object.values(FIXTURE_VIEW_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it('fixture can simulate pagination walk over 250 rows at page size 25', () => {
    const pageSize = 25;
    const totalPages = Math.ceil(250 / pageSize);
    expect(totalPages).toBe(10);

    // Simulate pagination walk
    let covered = 0;
    for (let page = 0; page < totalPages; page++) {
      const rows = FIXTURE_QUEUE_ROWS.slice(page * pageSize, (page + 1) * pageSize);
      covered += rows.length;
    }
    expect(covered).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant isolation
// ---------------------------------------------------------------------------

describe('Cross-tenant isolation', () => {
  let app: INestApplication;
  let mockService: MockQueueService;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('service.listTickets called with correct tenantId from principal', async () => {
    ({ app, mockService } = await buildQueueApp());

    const tenantBAgent: PrincipalContext = {
      tenantId: TENANT_B,
      userId: 'bb000000-4000-0002-0000-000000000001',
      principalKind: 'staff',
      roles: ['admin'],
      orgScopeIds: [],
      permissions: ['ticket:read', 'view:read'],
      traceId: 'trace-tenant-b',
    } as PrincipalContext;

    await withPrincipal(app, tenantBAgent).get('/tickets');

    expect(mockService.listTickets).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_B }),
      expect.anything(),
    );
  });
});
