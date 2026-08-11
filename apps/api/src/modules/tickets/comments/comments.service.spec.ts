/**
 * comments.service.spec.ts — unit tests for CommentsService and related utilities.
 *
 * Covers:
 *   - CreateCommentSchema validation (strict, body required, visibility enum)
 *   - CommentsService.create: portal internal → 403
 *   - CommentsService.create: portal on closed ticket → 422
 *   - CommentsService.create: visibility forcing for portal (always public)
 *   - CommentsService.create: first_response_at stamped for first public agent reply
 *   - CommentsService.create: first_response_at NOT stamped for internal comments
 *   - CommentsService.create: first_response_at NOT stamped for portal comments
 *   - CommentsService.create: outbox event emitted with correct visibility
 *   - CommentsService.create: 404 for unknown ticket
 *   - CommentsService.listPage: 404 for unknown ticket
 *   - CommentsService.listPage: cursor/limit forwarded to repo
 *   - decodeCommentCursor: rejects malformed input with 400
 *   - encodeCommentCursor / decodeCommentCursor: round-trip
 *
 * All tests use in-memory fakes — no NestJS container, no database, no sleeps.
 * Tests are independent and parallel-safe (no shared mutable state).
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreateCommentSchema } from './create-comment.dto';
import { CommentsService } from './comments.service';
import { encodeCommentCursor, decodeCommentCursor } from './comment-cursor';
import type { PrincipalContext } from '../../../observability/request-context';

// ---------------------------------------------------------------------------
// DTO schema validation
// ---------------------------------------------------------------------------

describe('CreateCommentSchema', () => {
  it('accepts a minimal valid payload', () => {
    const result = CreateCommentSchema.safeParse({ body: 'Hello' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe('public');
      expect(result.data.attachment_ids).toEqual([]);
    }
  });

  it('rejects empty body', () => {
    expect(CreateCommentSchema.safeParse({ body: '' }).success).toBe(false);
  });

  it('rejects whitespace-only body after trim', () => {
    expect(CreateCommentSchema.safeParse({ body: '   ' }).success).toBe(false);
  });

  it('accepts visibility=internal', () => {
    const r = CreateCommentSchema.safeParse({ body: 'Note', visibility: 'internal' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown visibility value', () => {
    expect(CreateCommentSchema.safeParse({ body: 'Note', visibility: 'secret' }).success).toBe(false);
  });

  it('rejects unknown properties (.strict)', () => {
    expect(CreateCommentSchema.safeParse({ body: 'Note', author_id: 'x' }).success).toBe(false);
  });

  it('rejects more than 10 attachment_ids', () => {
    expect(
      CreateCommentSchema.safeParse({
        body: 'Note',
        attachment_ids: Array.from({ length: 11 }, () => '00000000-0000-0000-0000-000000000001'),
      }).success,
    ).toBe(false);
  });

  it('trims body whitespace', () => {
    const r = CreateCommentSchema.safeParse({ body: '  hello  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.body).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// Cursor encode/decode
// ---------------------------------------------------------------------------

describe('encodeCommentCursor / decodeCommentCursor', () => {
  it('round-trips correctly', () => {
    const date = new Date('2024-06-01T12:00:00.000Z');
    const id = '00000000-0000-0000-0000-000000000042';
    const cursor = encodeCommentCursor(date, id);
    const decoded = decodeCommentCursor(cursor);
    expect(new Date(decoded.createdAt).toISOString()).toBe(date.toISOString());
    expect(decoded.id).toBe(id);
  });

  it('throws 400 on malformed base64', () => {
    expect(() => decodeCommentCursor('!!! not base64url !!!')).toThrow(BadRequestException);
  });

  it('throws 400 on missing id field', () => {
    const broken = Buffer.from(JSON.stringify({ createdAt: '2024-01-01T00:00:00Z' })).toString('base64url');
    expect(() => decodeCommentCursor(broken)).toThrow(BadRequestException);
  });

  it('throws 400 on invalid date', () => {
    const broken = Buffer.from(JSON.stringify({ createdAt: 'not-a-date', id: 'abc' })).toString('base64url');
    expect(() => decodeCommentCursor(broken)).toThrow(BadRequestException);
  });

  it('throws 400 on empty string', () => {
    expect(() => decodeCommentCursor('')).toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeTicket(status = 'open') {
  return {
    id: 'ticket-001',
    tenantId: 'tenant-001',
    organizationId: 'org-001',
    status,
    firstResponseAt: null,
  } as any;
}

function makeComment(visibility = 'public') {
  return {
    id: 'comment-001',
    ticketId: 'ticket-001',
    tenantId: 'tenant-001',
    organizationId: 'org-001',
    authorId: 'user-001',
    visibility,
    isInternal: visibility === 'internal',
    body: 'Test comment',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  } as any;
}

function makeTicketRepo(ticket: ReturnType<typeof makeTicket> | null = makeTicket()) {
  return { findById: jest.fn().mockResolvedValue(ticket) } as any;
}

function makeCommentRepo(overrides: Record<string, unknown> = {}) {
  return {
    insert: jest.fn().mockResolvedValue(makeComment()),
    stampFirstResponseAt: jest.fn().mockResolvedValue(false),
    emitCommentAddedEvent: jest.fn().mockResolvedValue(undefined),
    findPageByTicketId: jest.fn().mockResolvedValue({ rows: [], nextCursor: null }),
    ...overrides,
  } as any;
}

function makeAgentPrincipal(): PrincipalContext {
  return {
    userId: 'user-001',
    tenantId: 'tenant-001',
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds: ['org-001'],
    permissions: ['ticket:read', 'ticket:create', 'ticket:add_internal_note'],
    traceId: 'trace-001',
  } as PrincipalContext;
}

function makePortalPrincipal(): PrincipalContext {
  return {
    userId: 'portal-001',
    tenantId: 'tenant-001',
    principalKind: 'portal',
    roles: [],
    orgScopeIds: [],
    boundOrganizationId: 'org-001',
    permissions: ['ticket:read', 'ticket:create'],
    traceId: 'trace-portal',
  } as PrincipalContext;
}

const VALID_DTO = { body: 'Test comment', visibility: 'public', attachment_ids: [] };

// ---------------------------------------------------------------------------
// CommentsService.create
// ---------------------------------------------------------------------------

describe('CommentsService.create', () => {
  it('throws 404 when ticket not found', async () => {
    const svc = new CommentsService(makeTicketRepo(null), makeCommentRepo());
    await expect(svc.create(makeAgentPrincipal(), 'unknown', VALID_DTO))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('portal principal posting internal comment → 403', async () => {
    const svc = new CommentsService(makeTicketRepo(), makeCommentRepo());
    await expect(
      svc.create(makePortalPrincipal(), 'ticket-001', { ...VALID_DTO, visibility: 'internal' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('portal principal commenting on closed ticket → 422', async () => {
    const svc = new CommentsService(makeTicketRepo(makeTicket('closed')), makeCommentRepo());
    await expect(svc.create(makePortalPrincipal(), 'ticket-001', VALID_DTO))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('portal comment always stored with visibility=public', async () => {
    const commentRepo = makeCommentRepo();
    const svc = new CommentsService(makeTicketRepo(), commentRepo);

    await svc.create(makePortalPrincipal(), 'ticket-001', VALID_DTO);

    expect(commentRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'public' }),
    );
  });

  it('agent can post internal comment', async () => {
    const commentRepo = makeCommentRepo({
      insert: jest.fn().mockResolvedValue(makeComment('internal')),
    });
    const svc = new CommentsService(makeTicketRepo(), commentRepo);

    const result = await svc.create(makeAgentPrincipal(), 'ticket-001', {
      ...VALID_DTO,
      visibility: 'internal',
    });

    expect(commentRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'internal', isInternal: true }),
    );
    expect(result.visibility).toBe('internal');
  });

  it('stamps firstResponseAt for first public agent reply', async () => {
    const commentRepo = makeCommentRepo({
      stampFirstResponseAt: jest.fn().mockResolvedValue(true),
    });
    const svc = new CommentsService(makeTicketRepo(), commentRepo);

    await svc.create(makeAgentPrincipal(), 'ticket-001', VALID_DTO);

    expect(commentRepo.stampFirstResponseAt).toHaveBeenCalledWith('tenant-001', 'ticket-001');
  });

  it('does NOT stamp firstResponseAt for internal comments', async () => {
    const commentRepo = makeCommentRepo({
      insert: jest.fn().mockResolvedValue(makeComment('internal')),
    });
    const svc = new CommentsService(makeTicketRepo(), commentRepo);

    await svc.create(makeAgentPrincipal(), 'ticket-001', {
      ...VALID_DTO,
      visibility: 'internal',
    });

    expect(commentRepo.stampFirstResponseAt).not.toHaveBeenCalled();
  });

  it('does NOT stamp firstResponseAt for portal comments', async () => {
    const commentRepo = makeCommentRepo();
    const svc = new CommentsService(makeTicketRepo(), commentRepo);

    await svc.create(makePortalPrincipal(), 'ticket-001', VALID_DTO);

    expect(commentRepo.stampFirstResponseAt).not.toHaveBeenCalled();
  });

  it('emits ticket.comment_added outbox event with correct visibility', async () => {
    const commentRepo = makeCommentRepo();
    const svc = new CommentsService(makeTicketRepo(), commentRepo);

    await svc.create(makeAgentPrincipal(), 'ticket-001', VALID_DTO);

    expect(commentRepo.emitCommentAddedEvent).toHaveBeenCalledWith(
      'tenant-001',
      'ticket-001',
      'comment-001',
      'public',
      'user-001',
      undefined,
    );
  });

  it('outbox event carries internal visibility for internal comments', async () => {
    const commentRepo = makeCommentRepo({
      insert: jest.fn().mockResolvedValue(makeComment('internal')),
    });
    const svc = new CommentsService(makeTicketRepo(), commentRepo);

    await svc.create(makeAgentPrincipal(), 'ticket-001', {
      ...VALID_DTO,
      visibility: 'internal',
    });

    expect(commentRepo.emitCommentAddedEvent).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      'internal',
      expect.anything(),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// CommentsService.listPage
// ---------------------------------------------------------------------------

describe('CommentsService.listPage', () => {
  it('throws 404 for unknown ticket', async () => {
    const svc = new CommentsService(makeTicketRepo(null), makeCommentRepo());
    await expect(svc.listPage(makeAgentPrincipal(), 'unknown'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns page data with next_cursor', async () => {
    const mockRows = [makeComment('public')];
    const mockNextCursor = 'abc123';
    const commentRepo = makeCommentRepo({
      findPageByTicketId: jest.fn().mockResolvedValue({
        rows: mockRows,
        nextCursor: mockNextCursor,
      }),
    });
    const svc = new CommentsService(makeTicketRepo(), commentRepo);

    const result = await svc.listPage(makeAgentPrincipal(), 'ticket-001', undefined, 25);

    expect(result.data).toHaveLength(1);
    expect(result.next_cursor).toBe(mockNextCursor);
    expect(commentRepo.findPageByTicketId).toHaveBeenCalledWith('ticket-001', undefined, 25);
  });

  it('returns next_cursor=null when no more rows', async () => {
    const svc = new CommentsService(makeTicketRepo(), makeCommentRepo());

    const result = await svc.listPage(makeAgentPrincipal(), 'ticket-001');

    expect(result.next_cursor).toBeNull();
  });
});
