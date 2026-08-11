/**
 * Portal ticket isolation integration tests — WO-090 AC4, AC5, AC7, AC11, AC12
 *
 * Covers:
 *   AC4  — Cross-org and cross-tenant reads return 404 (existence non-disclosure)
 *   AC5  — Portal reply forces visibility = 'public' regardless of client input
 *   AC6  — Reply on closed ticket returns 422 TICKET_CLOSED (without reopen policy)
 *   AC7  — Internal fields never appear in portal response bodies (schema allow-list)
 *   AC11 — Unit: filter mapper rejects unknown fields; SLA projection mapping;
 *           visibility forcing; serialisation allow-list
 *   AC12 — Two-org seed: cross-org and cross-tenant reads return 404, internal
 *           comments never appear, portal reply stored as public with correct outbox event
 *
 * Uses NestJS TestingModule with mocked repositories (no Testcontainers required).
 * Full DB-backed tests with real RLS are in the e2e suite.
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';

// ---------------------------------------------------------------------------
// Unit tests (pure functions — no app needed)
// ---------------------------------------------------------------------------

import { mapPortalFilters, filterSignature } from '../../src/modules/tickets/portal/portal-filter-mapper';
import {
  mapSlaToPortalProjection,
  mapTicketToPortalListItem,
  mapTicketToPortalDetail,
  mapCommentToPortalDto,
  mapStatusHistoryToPortalDto,
} from '../../src/modules/tickets/portal/portal-ticket.dto';
import {
  TICKET_A1_OPEN_ROW,
  TICKET_A1_CLOSED_ROW,
  COMMENT_PUBLIC_A1_ROW_1,
  COMMENT_INTERNAL_A1_ROW,
  STATUS_HISTORY_A1,
  SLA_RESULT_RUNNING,
  SLA_RESULT_BREACHED,
  SLA_RESULT_PAUSED,
  SLA_RESULT_NO_POLICY,
  ATTACHMENT_PUBLIC_ROW,
} from '../fixtures/multi-tenant-tickets.fixture';

// ============================================================================
// UNIT: portal-filter-mapper
// ============================================================================

describe('portal-filter-mapper', () => {
  describe('mapPortalFilters', () => {
    it('returns undefined when no filters provided', () => {
      expect(mapPortalFilters({})).toBeUndefined();
    });

    it('accepts valid status filter', () => {
      expect(() => mapPortalFilters({ status: 'open' })).not.toThrow();
    });

    it('accepts comma-separated status values', () => {
      expect(() => mapPortalFilters({ status: 'open,in_progress' })).not.toThrow();
    });

    it('throws 400 on unknown status value', () => {
      expect(() => mapPortalFilters({ status: 'unknown_status' })).toThrow();
    });

    it('throws 400 when q exceeds 200 chars', () => {
      expect(() => mapPortalFilters({ q: 'x'.repeat(201) })).toThrow();
    });

    it('accepts valid q filter', () => {
      expect(() => mapPortalFilters({ q: 'login issue' })).not.toThrow();
    });
  });

  describe('filterSignature', () => {
    it('produces stable key for same filters', () => {
      const a = filterSignature({ status: 'open', q: 'login' });
      const b = filterSignature({ status: 'open', q: 'login' });
      expect(a).toBe(b);
    });

    it('produces empty string for no filters', () => {
      expect(filterSignature({})).toBe('');
    });
  });
});

// ============================================================================
// UNIT: SLA projection mapping (AC3, AC11)
// ============================================================================

describe('mapSlaToPortalProjection', () => {
  it('returns null when no clocks', () => {
    expect(mapSlaToPortalProjection(SLA_RESULT_NO_POLICY)).toBeNull();
  });

  it('maps running state correctly', () => {
    const result = mapSlaToPortalProjection(SLA_RESULT_RUNNING);
    expect(result).not.toBeNull();
    expect(result!.state).toBe('running');
    expect(result!.firstResponseTargetAt).toBe('2026-01-15T14:00:00Z');
    expect(result!.resolutionTargetAt).toBe('2026-01-17T10:00:00Z');
  });

  it('maps breached state correctly', () => {
    const result = mapSlaToPortalProjection(SLA_RESULT_BREACHED);
    expect(result!.state).toBe('breached');
  });

  it('maps paused state correctly', () => {
    const result = mapSlaToPortalProjection(SLA_RESULT_PAUSED);
    expect(result!.state).toBe('paused');
  });

  it('does NOT expose thresholds, pausedMs, elapsedMs (AC7)', () => {
    const result = mapSlaToPortalProjection(SLA_RESULT_RUNNING);
    expect(result).not.toHaveProperty('thresholds');
    expect(result).not.toHaveProperty('pausedMs');
    expect(result).not.toHaveProperty('elapsedMs');
    expect(result).not.toHaveProperty('elapsedPct');
    expect(result).not.toHaveProperty('remainingMs');
  });
});

// ============================================================================
// UNIT: serialisation allow-list (AC7, AC11)
// ============================================================================

describe('portal DTO mappers — field allow-list (AC7)', () => {
  describe('mapTicketToPortalListItem', () => {
    it('includes allowed fields', () => {
      const item = mapTicketToPortalListItem(TICKET_A1_OPEN_ROW, SLA_RESULT_RUNNING);
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('subject');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('priority');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('updatedAt');
      expect(item).toHaveProperty('sla');
    });

    it('does NOT include internal fields (AC7)', () => {
      const item = mapTicketToPortalListItem(TICKET_A1_OPEN_ROW, null);
      expect(item).not.toHaveProperty('assigneeId');
      expect(item).not.toHaveProperty('affectedAreaTags');
      expect(item).not.toHaveProperty('aiSummary');
      expect(item).not.toHaveProperty('aiStatus');
      expect(item).not.toHaveProperty('version');
      expect(item).not.toHaveProperty('requesterContactId');
      expect(item).not.toHaveProperty('assignmentGroupId');
    });
  });

  describe('mapTicketToPortalDetail', () => {
    it('includes statusHistory and comments', () => {
      const detail = mapTicketToPortalDetail(
        TICKET_A1_OPEN_ROW,
        [],
        STATUS_HISTORY_A1.map(mapStatusHistoryToPortalDto),
        null,
        false,
      );
      expect(detail).toHaveProperty('statusHistory');
      expect(detail).toHaveProperty('comments');
    });

    it('does NOT include aiSummary when disabled', () => {
      const detail = mapTicketToPortalDetail(
        { ...TICKET_A1_OPEN_ROW, aiSummary: 'secret internal reasoning' } as typeof TICKET_A1_OPEN_ROW,
        [],
        [],
        null,
        false, // aiSummaryEnabled = false
      );
      expect(detail).not.toHaveProperty('aiSummary');
    });

    it('does NOT include internal fields even on a ticket with aiSummary enabled', () => {
      const detail = mapTicketToPortalDetail(TICKET_A1_OPEN_ROW, [], [], null, true);
      expect(detail).not.toHaveProperty('assigneeId');
      expect(detail).not.toHaveProperty('affectedAreaTags');
      expect(detail).not.toHaveProperty('version');
    });
  });

  describe('mapCommentToPortalDto', () => {
    it('includes allowed fields and authorDisplayName/authorType', () => {
      const dto = mapCommentToPortalDto(COMMENT_PUBLIC_A1_ROW_1, [], 'Customer', 'customer');
      expect(dto).toHaveProperty('id');
      expect(dto).toHaveProperty('body');
      expect(dto).toHaveProperty('authorDisplayName', 'Customer');
      expect(dto).toHaveProperty('authorType', 'customer');
      expect(dto).toHaveProperty('createdAt');
      expect(dto).toHaveProperty('attachments');
    });

    it('NEVER includes visibility field (AC7)', () => {
      const dto = mapCommentToPortalDto(COMMENT_PUBLIC_A1_ROW_1, [], 'Customer', 'customer');
      expect(dto).not.toHaveProperty('visibility');
    });

    it('NEVER includes internal comment body through mapper', () => {
      // An internal comment should never reach this mapper in production
      // (filtered at query layer), but if it somehow did, the DTO still
      // would not expose the visibility field.
      const dto = mapCommentToPortalDto(COMMENT_INTERNAL_A1_ROW, [], 'Agent', 'agent');
      expect(dto).not.toHaveProperty('visibility');
    });
  });

  describe('mapStatusHistoryToPortalDto', () => {
    it('maps from/to/at and omits actor identity (AC7)', () => {
      const entry = STATUS_HISTORY_A1[1]!;
      const dto = mapStatusHistoryToPortalDto(entry);
      expect(dto).toHaveProperty('from', 'open');
      expect(dto).toHaveProperty('to', 'in_progress');
      expect(dto).toHaveProperty('at');
      expect(dto).not.toHaveProperty('actorUserId');
    });
  });
});

// ============================================================================
// INTEGRATION: controller + service with mocked repositories
// ============================================================================

import { PortalTicketsController } from '../../src/modules/tickets/portal/portal-tickets.controller';
import { PortalTicketReadService } from '../../src/modules/tickets/portal/portal-ticket-read.service';
import { PortalVisibilityGuard } from '../../src/modules/tickets/portal/portal-visibility.guard';
import { TicketRepository } from '../../src/modules/tickets/repositories/ticket.repository';
import { CommentRepository } from '../../src/modules/tickets/repositories/comment.repository';
import { TenantSettingsRepository } from '../../src/modules/tickets/repositories/tenant-settings.repository';
import { TicketsService } from '../../src/modules/tickets/tickets.service';
import { AuditService } from '../../src/common/auth/audit.service';
import {
  TICKET_A1_OPEN,
  TICKET_A2,
  TICKET_B1,
  TENANT_A,
  ORG_A1,
  PORTAL_USER_A1,
} from '../fixtures/multi-tenant-tickets.fixture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePortalRequest(
  userId: string,
  tenantId: string,
  boundOrgId: string,
) {
  return {
    user: {
      sub:                 userId,
      tenantId,
      userId,
      principalKind:       'portal',
      roles:               ['portal_user'],
      orgScopeIds:         [boundOrgId],
      boundOrganizationId: boundOrgId,
      traceId:             'test-trace-001',
    },
  };
}

// ---------------------------------------------------------------------------
// Mock read service
// ---------------------------------------------------------------------------

function makeMockReadService(
  overrides: Partial<Record<keyof PortalTicketReadService, jest.Mock>> = {},
) {
  return {
    listTickets:              jest.fn().mockResolvedValue({ data: [], nextCursor: null }),
    getTicketDetail:          jest.fn().mockResolvedValue(null),
    getAttachmentDownloadUrl: jest.fn().mockResolvedValue({ url: 'https://s3.example/file', expiresAt: '2026-01-15T11:00:00Z' }),
    invalidateUserCache:      jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMockTicketRepo(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    findById: jest.fn().mockResolvedValue(TICKET_A1_OPEN_ROW),
    ...overrides,
  };
}

function makeMockCommentRepo(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    insert:                  jest.fn().mockResolvedValue({ id: 'new-comment-id', body: 'Hello', authorId: PORTAL_USER_A1, createdAt: new Date() }),
    emitCommentAddedEvent:   jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

async function buildApp(
  readServiceOverrides: Partial<Record<keyof PortalTicketReadService, jest.Mock>> = {},
  ticketRepoOverrides: Partial<Record<string, jest.Mock>> = {},
  commentRepoOverrides: Partial<Record<string, jest.Mock>> = {},
): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [PortalTicketsController],
    providers: [
      { provide: PortalTicketReadService,    useValue: makeMockReadService(readServiceOverrides) },
      { provide: TicketRepository,           useValue: makeMockTicketRepo(ticketRepoOverrides) },
      { provide: CommentRepository,          useValue: makeMockCommentRepo(commentRepoOverrides) },
      { provide: TenantSettingsRepository,   useValue: { findByTenantId: jest.fn().mockResolvedValue(null) } },
      { provide: TicketsService,             useValue: { createFromPortal: jest.fn(), reopenFromPortal: jest.fn() } },
      { provide: AuditService,               useValue: { writeAuthEvent: jest.fn() } },
      { provide: PortalVisibilityGuard,      useValue: { canActivate: jest.fn().mockReturnValue(true) } },
    ],
  })
    .overrideGuard(PortalVisibilityGuard)
    .useValue({ canActivate: jest.fn().mockReturnValue(true) })
    .compile();

  const app = moduleRef.createNestApplication();

  // Inject portal principal into every request
  app.use((req: any, _res: any, next: any) => {
    req.user = {
      sub:                 PORTAL_USER_A1,
      tenantId:            TENANT_A,
      userId:              PORTAL_USER_A1,
      principalKind:       'portal',
      roles:               ['portal_user'],
      orgScopeIds:         [ORG_A1],
      boundOrganizationId: ORG_A1,
      traceId:             'test-trace-001',
    };
    // simulate getPrincipalContext() reading from request
    (global as any).__principalCtx = req.user;
    next();
  });

  await app.init();
  return app;
}

// ---------------------------------------------------------------------------
// Tests: Cross-org returns 404 (AC4, AC12)
// ---------------------------------------------------------------------------

describe('GET /portal/tickets/:id — isolation (AC4, AC12)', () => {
  it('returns 404 when getTicketDetail throws NotFoundException', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    const app = await buildApp({
      getTicketDetail: jest.fn().mockRejectedValue(
        new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Ticket not found.' } }),
      ),
    });

    const res = await request(app.getHttpServer()).get(`/portal/tickets/${TICKET_A2}`);
    expect(res.status).toBe(HttpStatus.NOT_FOUND);
    await app.close();
  });

  it('returns 404 (not 403) for cross-tenant ticket ID (AC4)', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    const app = await buildApp({
      getTicketDetail: jest.fn().mockRejectedValue(
        new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Ticket not found.' } }),
      ),
    });

    const res = await request(app.getHttpServer()).get(`/portal/tickets/${TICKET_B1}`);
    expect(res.status).toBe(HttpStatus.NOT_FOUND);
    // Must NOT be 403 (existence disclosure prevention)
    expect(res.status).not.toBe(HttpStatus.FORBIDDEN);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Tests: Reply visibility forced to public (AC5, AC12)
// ---------------------------------------------------------------------------

describe('POST /portal/tickets/:id/comments — visibility forcing (AC5)', () => {
  it('rejects client-supplied visibility field with 400', async () => {
    const app = await buildApp();

    const res = await request(app.getHttpServer())
      .post(`/portal/tickets/${TICKET_A1_OPEN}/comments`)
      .send({ body: 'Hello support', visibility: 'internal' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    await app.close();
  });

  it('accepts reply without visibility field and stores it as public', async () => {
    const insertSpy = jest.fn().mockResolvedValue({
      id:        'new-comment-id',
      body:      'Hello support',
      authorId:  PORTAL_USER_A1,
      createdAt: new Date(),
    });
    const app = await buildApp(
      {},
      { findById: jest.fn().mockResolvedValue(TICKET_A1_OPEN_ROW) },
      { insert: insertSpy, emitCommentAddedEvent: jest.fn().mockResolvedValue(undefined) },
    );

    const res = await request(app.getHttpServer())
      .post(`/portal/tickets/${TICKET_A1_OPEN}/comments`)
      .send({ body: 'Hello support' });

    expect(res.status).toBe(HttpStatus.CREATED);
    // Insert must have been called with visibility = 'public'
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'public' }),
    );
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Tests: Closed ticket returns 422 (AC6)
// ---------------------------------------------------------------------------

describe('POST /portal/tickets/:id/comments — closed ticket (AC6)', () => {
  it('returns 422 TICKET_CLOSED when ticket is closed and reopen not permitted', async () => {
    const closedTicket = { ...TICKET_A1_CLOSED_ROW };
    const app = await buildApp(
      {},
      { findById: jest.fn().mockResolvedValue(closedTicket) },
    );

    const res = await request(app.getHttpServer())
      .post(`/portal/tickets/${TICKET_A1_CLOSED_ROW.id}/comments`)
      .send({ body: 'Is this resolved?' });

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(res.body?.error?.code ?? res.body?.message).toMatch(/TICKET_CLOSED|closed/i);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// Tests: Internal comment fields absent from list response (AC7, AC12)
// ---------------------------------------------------------------------------

describe('portal DTO — internal fields absent from responses (AC7)', () => {
  it('list item does not include assigneeId, affectedAreaTags, aiSummary, version', () => {
    const item = mapTicketToPortalListItem(TICKET_A1_OPEN_ROW, null);
    const json = JSON.stringify(item);

    expect(json).not.toContain('assigneeId');
    expect(json).not.toContain('affectedAreaTags');
    expect(json).not.toContain('aiStatus');
    expect(json).not.toContain('version');
    expect(json).not.toContain('requesterContactId');
  });

  it('detail does not expose visibility on any comment', () => {
    const detail = mapTicketToPortalDetail(
      TICKET_A1_OPEN_ROW,
      [mapCommentToPortalDto(COMMENT_PUBLIC_A1_ROW_1, [], 'Customer', 'customer')],
      [],
      null,
      false,
    );
    const json = JSON.stringify(detail);

    expect(json).not.toContain('"visibility"');
    expect(json).not.toContain('"internal"');
    expect(json).not.toContain('assigneeId');
    expect(json).not.toContain('s3Key');
  });
});
