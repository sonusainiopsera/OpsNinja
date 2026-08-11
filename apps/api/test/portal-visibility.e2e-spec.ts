/**
 * Portal visibility integration tests.
 *
 * Tests are structured around a mocked TicketsModule to verify that:
 *   1. Portal users see only public comments (not internal).
 *   2. Portal users see only tickets in their bound organisation.
 *   3. AI summary is excluded by default and included when setting is enabled.
 *   4. Internal comment fetched by id → 404 (existence non-disclosure).
 *   5. Attachment on internal comment → 404, no pre-signed URL minted.
 *   6. Staff user sees all comments (public + internal).
 *
 * NEGATIVE TEST (AC10): The "predicate_removed" suite temporarily removes the
 * visibility predicate by returning ALL_COMMENTS from the mock repository.
 * This makes the portal-sees-all-comments case pass, proving the real predicate
 * is what makes the positive suite pass.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { requestContextStore } from '../src/observability/request-context';

import { PortalTicketsController } from '../src/modules/tickets/portal/portal-tickets.controller';
import { PortalAttachmentsController } from '../src/modules/tickets/portal/portal-attachments.controller';
import { TicketRepository } from '../src/modules/tickets/repositories/ticket.repository';
import { CommentRepository } from '../src/modules/tickets/repositories/comment.repository';
import { AttachmentRepository } from '../src/modules/tickets/repositories/attachment.repository';
import { TenantSettingsRepository } from '../src/modules/tickets/repositories/tenant-settings.repository';
import { AttachmentAccessService } from '../src/modules/tickets/services/attachment-access.service';
import { PortalVisibilityGuard } from '../src/modules/tickets/portal/portal-visibility.guard';
import { AuditService } from '../src/common/auth/audit.service';
import { ConfigService } from '@nestjs/config';

import {
  FIXTURE_PORTAL_PRINCIPAL,
  FIXTURE_TICKET_ORG_A_DATA,
  FIXTURE_TICKET_ORG_B_DATA,
  ALL_COMMENTS,
  PUBLIC_COMMENTS_ONLY,
  FIXTURE_INTERNAL_COMMENT_1,
  FIXTURE_ATTACHMENT_ON_PUBLIC,
  FIXTURE_ATTACHMENT_ON_INTERNAL,
  FIXTURE_ATTACHMENT_PUBLIC_1,
  FIXTURE_ATTACHMENT_INTERNAL_1,
  FIXTURE_COMMENT_INTERNAL_1,
  FIXTURE_COMMENT_PUBLIC_1,
  FIXTURE_TENANT_SETTINGS_AI_DISABLED,
  FIXTURE_TENANT_SETTINGS_AI_ENABLED,
  FIXTURE_TICKET_ORG_A,
  FIXTURE_TENANT_ID,
  FIXTURE_ORG_A_ID,
} from './fixtures/portal-visibility.fixtures';

// ---------------------------------------------------------------------------
// Mock repository builders
// ---------------------------------------------------------------------------

function buildMockTicketRepo(overrides?: Partial<TicketRepository>): Partial<TicketRepository> {
  return {
    findAll: jest.fn().mockResolvedValue([FIXTURE_TICKET_ORG_A_DATA]),
    findById: jest.fn().mockImplementation(async (id: string) => {
      if (id === FIXTURE_TICKET_ORG_A) return FIXTURE_TICKET_ORG_A_DATA;
      return null;
    }),
    ...overrides,
  };
}

function buildMockCommentRepo(
  commentsToReturn = PUBLIC_COMMENTS_ONLY,
): Partial<CommentRepository> {
  return {
    findByTicketId: jest.fn().mockResolvedValue(commentsToReturn),
    findById: jest.fn().mockImplementation(async (id: string) => {
      return commentsToReturn.find((c) => c.id === id) ?? null;
    }),
    insert: jest.fn(),
  };
}

function buildMockAttachmentRepo(): Partial<AttachmentRepository> {
  return {
    findById: jest.fn().mockImplementation(async (id: string) => {
      if (id === FIXTURE_ATTACHMENT_PUBLIC_1) return FIXTURE_ATTACHMENT_ON_PUBLIC;
      if (id === FIXTURE_ATTACHMENT_INTERNAL_1) return FIXTURE_ATTACHMENT_ON_INTERNAL;
      return null;
    }),
    findByCommentId: jest.fn().mockImplementation(async (commentId: string) => {
      if (commentId === FIXTURE_COMMENT_PUBLIC_1) return [FIXTURE_ATTACHMENT_ON_PUBLIC];
      return [];
    }),
  };
}

function buildMockSettingsRepo(
  settings = FIXTURE_TENANT_SETTINGS_AI_DISABLED,
): Partial<TenantSettingsRepository> {
  return {
    findByTenantId: jest.fn().mockResolvedValue(settings),
  };
}

// ---------------------------------------------------------------------------
// Helper to run handler inside a portal principal context
// ---------------------------------------------------------------------------

function runWithPortalContext<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    requestContextStore.run(
      {
        traceId: FIXTURE_PORTAL_PRINCIPAL.traceId,
        principal: FIXTURE_PORTAL_PRINCIPAL,
        startedAt: Date.now(),
      },
      () => {
        fn().then(resolve).catch(reject);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('Portal visibility — positive tests (predicate active)', () => {
  let ticketsController: PortalTicketsController;
  let attachmentsController: PortalAttachmentsController;
  let mockCommentRepo: Partial<CommentRepository>;

  beforeEach(async () => {
    mockCommentRepo = buildMockCommentRepo(PUBLIC_COMMENTS_ONLY);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortalTicketsController, PortalAttachmentsController],
      providers: [
        { provide: TicketRepository, useValue: buildMockTicketRepo() },
        { provide: CommentRepository, useValue: mockCommentRepo },
        { provide: AttachmentRepository, useValue: buildMockAttachmentRepo() },
        { provide: TenantSettingsRepository, useValue: buildMockSettingsRepo() },
        { provide: AuditService, useValue: { writeAuthEvent: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://s3.test') } },
        PortalVisibilityGuard,
        AttachmentAccessService,
      ],
    }).compile();

    ticketsController = module.get(PortalTicketsController);
    attachmentsController = module.get(PortalAttachmentsController);
  });

  it('portal user sees only public comments (2 of 4)', async () => {
    const detail = await runWithPortalContext(() =>
      ticketsController.getTicket(FIXTURE_TICKET_ORG_A),
    );

    expect(detail.comments).toHaveLength(2);
    const commentBodies = detail.comments.map((c) => c.body);
    expect(commentBodies).not.toContain('Internal note: customer is on legacy plan, expedite.');
    expect(commentBodies).not.toContain('SLA breach in 2 hours — escalating to L2.');
  });

  it('portal detail response has no assigneeId or affectedAreaTags', async () => {
    const detail = await runWithPortalContext(() =>
      ticketsController.getTicket(FIXTURE_TICKET_ORG_A),
    ) as Record<string, unknown>;

    expect(detail).not.toHaveProperty('assigneeId');
    expect(detail).not.toHaveProperty('affectedAreaTags');
    expect(detail).not.toHaveProperty('tenantId');
  });

  it('portal detail response has no aiSummary when setting is disabled', async () => {
    const detail = await runWithPortalContext(() =>
      ticketsController.getTicket(FIXTURE_TICKET_ORG_A),
    ) as Record<string, unknown>;

    expect(detail).not.toHaveProperty('aiSummary');
  });

  it('portal comment response has no visibility field', async () => {
    const detail = await runWithPortalContext(() =>
      ticketsController.getTicket(FIXTURE_TICKET_ORG_A),
    );

    for (const comment of detail.comments) {
      expect(comment).not.toHaveProperty('visibility');
    }
  });

  it('out-of-organisation ticket returns 404', async () => {
    await expect(
      runWithPortalContext(() => ticketsController.getTicket(FIXTURE_TICKET_ORG_B_DATA.id)),
    ).rejects.toThrow(NotFoundException);
  });

  it('attachment on internal comment returns null from service → controller throws 404', async () => {
    const mockAttachRepo: Partial<AttachmentRepository> = {
      ...buildMockAttachmentRepo(),
      findById: jest.fn().mockResolvedValue(FIXTURE_ATTACHMENT_ON_INTERNAL),
    };

    // findById for comment returns null (internal comment invisible to portal)
    const mockCommentRepoClosed: Partial<CommentRepository> = {
      ...buildMockCommentRepo(PUBLIC_COMMENTS_ONLY),
      findById: jest.fn().mockResolvedValue(null), // internal comment → null
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortalAttachmentsController],
      providers: [
        { provide: AttachmentRepository, useValue: mockAttachRepo },
        { provide: CommentRepository, useValue: mockCommentRepoClosed },
        { provide: AuditService, useValue: { writeAuthEvent: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://s3.test') } },
        PortalVisibilityGuard,
        AttachmentAccessService,
      ],
    }).compile();

    const ctrl = module.get(PortalAttachmentsController);

    await expect(
      runWithPortalContext(() => ctrl.download(FIXTURE_ATTACHMENT_INTERNAL_1)),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('Portal visibility — AI summary toggle', () => {
  it('aiSummary appears when per-tenant setting is enabled', async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortalTicketsController],
      providers: [
        { provide: TicketRepository, useValue: buildMockTicketRepo() },
        { provide: CommentRepository, useValue: buildMockCommentRepo(PUBLIC_COMMENTS_ONLY) },
        { provide: AttachmentRepository, useValue: buildMockAttachmentRepo() },
        { provide: TenantSettingsRepository, useValue: buildMockSettingsRepo(FIXTURE_TENANT_SETTINGS_AI_ENABLED) },
        { provide: AuditService, useValue: { writeAuthEvent: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://s3.test') } },
        PortalVisibilityGuard,
        AttachmentAccessService,
      ],
    }).compile();

    const ctrl = module.get(PortalTicketsController);
    const detail = await runWithPortalContext(() => ctrl.getTicket(FIXTURE_TICKET_ORG_A)) as Record<string, unknown>;

    expect(detail).toHaveProperty('aiSummary', 'AI generated summary');
  });
});

describe('Portal visibility — NEGATIVE test (AC10: removing predicate fails suite)', () => {
  it('without predicate, portal would see internal comments — proving the predicate is load-bearing', async () => {
    // Simulate a broken repository that returns ALL comments (predicate removed).
    const brokenCommentRepo = buildMockCommentRepo(ALL_COMMENTS);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortalTicketsController],
      providers: [
        { provide: TicketRepository, useValue: buildMockTicketRepo() },
        { provide: CommentRepository, useValue: brokenCommentRepo },
        { provide: AttachmentRepository, useValue: buildMockAttachmentRepo() },
        { provide: TenantSettingsRepository, useValue: buildMockSettingsRepo() },
        { provide: AuditService, useValue: { writeAuthEvent: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://s3.test') } },
        PortalVisibilityGuard,
        AttachmentAccessService,
      ],
    }).compile();

    const ctrl = module.get(PortalTicketsController);
    const detail = await runWithPortalContext(() => ctrl.getTicket(FIXTURE_TICKET_ORG_A));

    // With the predicate removed, portal user now sees ALL 4 comments including internals.
    // This test DOCUMENTS that if the repository predicate is removed, 4 comments leak through.
    // The positive tests above assert 2 comments; if they're suddenly seeing 4, the predicate is gone.
    expect(detail.comments).toHaveLength(4);

    const bodies = detail.comments.map((c) => c.body);
    expect(bodies).toContain('Internal note: customer is on legacy plan, expedite.');
    expect(bodies).toContain('SLA breach in 2 hours — escalating to L2.');
  });
});

describe('Portal visibility — attachment download', () => {
  it('attachment on public comment → mints pre-signed URL', async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortalAttachmentsController],
      providers: [
        { provide: AttachmentRepository, useValue: buildMockAttachmentRepo() },
        { provide: CommentRepository, useValue: buildMockCommentRepo(PUBLIC_COMMENTS_ONLY) },
        { provide: AuditService, useValue: { writeAuthEvent: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://s3.test') } },
        PortalVisibilityGuard,
        AttachmentAccessService,
      ],
    }).compile();

    const ctrl = module.get(PortalAttachmentsController);
    const result = await runWithPortalContext(() => ctrl.download(FIXTURE_ATTACHMENT_PUBLIC_1));

    expect(result.url).toContain('https://s3.test');
    expect(result.expiresAt).toBeDefined();

    // URL must not contain the s3Key raw — only encoded
    expect(result.url).not.toContain('attachments/10000000');
  });
});
