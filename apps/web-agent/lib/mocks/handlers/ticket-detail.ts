/**
 * MSW handlers for ticket detail, comments, attachments, and AI states — WO-042.
 *
 * Committed alongside component tests so the detail page runs offline without
 * a live backend.  State is held in module-level mutable objects so tests can
 * inspect or reset it; call resetDetailHandlers() in afterEach.
 */

import { http, HttpResponse, delay } from 'msw';
import type {
  TicketDetail,
  TicketDetailResponse,
  Comment,
  CommentListResponse,
  PresignResponse,
  FinalizeAttachmentResponse,
  ResolveTicketResponse,
} from '../../api/tickets/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = '2026-08-11T10:00:00.000Z';
const TARGET_AT = '2026-08-11T14:00:00.000Z';   // 4 h window
const REMINDER_50 = '2026-08-11T12:00:00.000Z'; // 50% = 2 h in
const REMINDER_75 = '2026-08-11T13:00:00.000Z'; // 75% = 3 h in

export const MOCK_TICKET_DETAIL: TicketDetail = {
  id: 'ticket-0001',
  ticketNumber: 10001,
  subject: 'Production database connection pool exhausted',
  description: 'Connections have been exhausted since 09:55 UTC. Impact: all write operations failing.',
  status: 'in_progress',
  priority: 'P1',
  categoryId: 'cat-1',
  categoryPath: 'Infrastructure / Database',
  organizationId: 'org-1',
  organizationName: 'Acme Corp',
  assigneeUserId: 'user-001',
  assigneeName: 'Alice Agent',
  tags: [
    { id: 'tag-1', name: 'customer-impact' },
    { id: 'tag-2', name: 'database' },
  ],
  customFields: { cloud_provider: 'aws', region: 'eu-west-1' },
  sla: {
    state: 'warning',
    targetAt: TARGET_AT,
    serverNow: NOW,
    pausedMs: 0,
    pausedSince: null,
    reminder50At: REMINDER_50,
    reminder75At: REMINDER_75,
    breachedAt: null,
  },
  jiraLink: null,
  jiraIntegrationEnabled: true,
  aiStatus: 'pending',
  aiCrux: null,
  aiAffectedAreaTags: [],
  allowedTransitions: ['pending_customer', 'pending_engineering', 'resolved', 'closed'],
  version: 3,
  createdAt: '2026-08-11T09:55:00.000Z',
  updatedAt: NOW,
};

/** Variant with AI ready */
export const MOCK_TICKET_AI_READY: TicketDetail = {
  ...MOCK_TICKET_DETAIL,
  aiStatus: 'ready',
  aiCrux: 'Connection pool exhausted due to a long-running migration query left uncommitted.',
  aiAffectedAreaTags: [
    { id: 'area-1', name: 'Database' },
    { id: 'area-2', name: 'Write path' },
  ],
};

/** Variant with AI failed */
export const MOCK_TICKET_AI_FAILED: TicketDetail = {
  ...MOCK_TICKET_DETAIL,
  aiStatus: 'failed',
};

/** Variant with no Jira integration */
export const MOCK_TICKET_NO_JIRA: TicketDetail = {
  ...MOCK_TICKET_DETAIL,
  jiraIntegrationEnabled: false,
};

// ---------------------------------------------------------------------------
// Comments fixtures
// ---------------------------------------------------------------------------

function makeComment(idx: number, visibility: 'public' | 'internal' = 'public'): Comment {
  return {
    id: `comment-${idx.toString().padStart(3, '0')}`,
    ticketId: MOCK_TICKET_DETAIL.id,
    visibility,
    body: visibility === 'internal'
      ? `Internal note ${idx}: escalated to DBA team, checking long-running queries.`
      : `Reply ${idx}: We are investigating the issue and will update you shortly.`,
    author: {
      id: visibility === 'internal' ? 'user-001' : 'user-portal-001',
      name: visibility === 'internal' ? 'Alice Agent' : 'Bob Customer',
      avatarUrl: null,
      kind: visibility === 'internal' ? 'staff' : 'portal',
    },
    attachments: idx === 2
      ? [{
        id: 'att-001',
        filename: 'db-metrics.png',
        contentType: 'image/png',
        sizeBytes: 48230,
        downloadUrl: '/mock/db-metrics.png',
      }]
      : [],
    createdAt: new Date(Date.parse(NOW) - (10 - idx) * 300_000).toISOString(),
    updatedAt: new Date(Date.parse(NOW) - (10 - idx) * 300_000).toISOString(),
  };
}

export const MOCK_COMMENTS: Comment[] = [
  makeComment(1, 'public'),
  makeComment(2, 'public'),
  makeComment(3, 'internal'),
  makeComment(4, 'public'),
  makeComment(5, 'internal'),
];

// ---------------------------------------------------------------------------
// Mutable state (reset between tests)
// ---------------------------------------------------------------------------

let mockTicket: TicketDetail = { ...MOCK_TICKET_DETAIL };
let mockComments: Comment[]  = [...MOCK_COMMENTS];
let nextCommentIdx = 6;

export function resetDetailHandlers() {
  mockTicket = { ...MOCK_TICKET_DETAIL };
  mockComments = [...MOCK_COMMENTS];
  nextCommentIdx = 6;
}

/** Mutate the stored ticket — useful in tests to set aiStatus, force 409, etc. */
export function patchMockTicket(partial: Partial<TicketDetail>) {
  mockTicket = { ...mockTicket, ...partial };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const ticketDetailHandlers = [
  // GET /api/v1/tickets/:id — ticket detail
  http.get('/api/v1/tickets/:id', async ({ params }) => {
    await delay(60);
    if (params['id'] === 'ticket-0001' || params['id'] === mockTicket.id) {
      const response: TicketDetailResponse = { data: mockTicket, traceId: 'trace-mock-001' };
      return HttpResponse.json(response);
    }
    return HttpResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Ticket not found.' } },
      { status: 404 },
    );
  }),

  // PATCH /api/v1/tickets/:id — update ticket properties
  http.patch('/api/v1/tickets/:id', async ({ params, request }) => {
    await delay(80);
    if (params['id'] !== mockTicket.id) {
      return HttpResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
    }
    const body = await request.json() as { version?: number; priority?: string };
    if (body.version !== undefined && body.version !== mockTicket.version) {
      return HttpResponse.json(
        {
          error: {
            code: 'VERSION_CONFLICT',
            message: 'Ticket was modified by another agent.',
            details: [{ currentVersion: mockTicket.version }],
          },
        },
        { status: 409 },
      );
    }
    mockTicket = { ...mockTicket, ...body, version: mockTicket.version + 1 };
    const response: TicketDetailResponse = { data: mockTicket, traceId: 'trace-mock-002' };
    return HttpResponse.json(response);
  }),

  // GET /api/v1/tickets/:id/comments — paginated thread
  http.get('/api/v1/tickets/:id/comments', async () => {
    await delay(60);
    const response: CommentListResponse = {
      data: mockComments,
      nextCursor: null,
      hasMore: false,
    };
    return HttpResponse.json(response);
  }),

  // POST /api/v1/tickets/:id/comments — add comment
  http.post('/api/v1/tickets/:id/comments', async ({ request }) => {
    await delay(80);
    const body = await request.json() as { body: string; visibility: 'public' | 'internal' };
    const newComment = makeComment(nextCommentIdx++, body.visibility);
    (newComment as { body: string }).body = body.body;
    mockComments.push(newComment);
    return HttpResponse.json({ data: newComment }, { status: 201 });
  }),

  // POST /api/v1/tickets/:id/attachments/presign
  http.post('/api/v1/tickets/:id/attachments/presign', async ({ request }) => {
    await delay(100);
    const body = await request.json() as { filename: string; contentType: string; sizeBytes: number };

    // Reject oversized files
    if (body.sizeBytes > 25 * 1024 * 1024) {
      return HttpResponse.json(
        { error: { code: 'FILE_TOO_LARGE', message: 'File exceeds 25 MB limit.' } },
        { status: 422 },
      );
    }

    const response: PresignResponse = {
      uploadId: `upload-${Date.now()}`,
      uploadUrl: '/mock/storage/upload',
      fields: { key: `tickets/${mockTicket.id}/${body.filename}` },
      maxBytes: 25 * 1024 * 1024,
      allowedContentTypes: ['image/png', 'image/jpeg', 'application/pdf'],
    };
    return HttpResponse.json(response);
  }),

  // POST /mock/storage/upload — fake S3 endpoint
  http.post('/mock/storage/upload', async () => {
    await delay(200);
    return new HttpResponse(null, { status: 204 });
  }),

  // POST /api/v1/tickets/:id/attachments/finalize
  http.post('/api/v1/tickets/:id/attachments/finalize', async ({ request }) => {
    await delay(80);
    const body = await request.json() as { uploadId: string; filename: string; contentType: string };

    // Reject unexpected content types at finalize
    const allowed = new Set(['image/png', 'image/jpeg', 'image/gif', 'application/pdf', 'text/csv']);
    if (!allowed.has(body.contentType)) {
      return HttpResponse.json(
        {
          error: {
            code: 'CONTENT_TYPE_REJECTED',
            message: `File type "${body.contentType}" is not allowed. Accepted: images, PDF, CSV.`,
          },
        },
        { status: 422 },
      );
    }

    const response: FinalizeAttachmentResponse = {
      attachmentId: `att-${body.uploadId}`,
      downloadUrl: `/mock/attachments/${body.filename}`,
    };
    return HttpResponse.json(response);
  }),

  // POST /api/v1/tickets/:id/resolve
  http.post('/api/v1/tickets/:id/resolve', async ({ params, request }) => {
    await delay(120);
    if (params['id'] !== mockTicket.id) {
      return HttpResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
    }
    const body = await request.json() as { version: number; resolutionNote: string };
    if (body.version !== mockTicket.version) {
      return HttpResponse.json(
        { error: { code: 'VERSION_CONFLICT', message: 'Ticket was modified.' } },
        { status: 409 },
      );
    }
    mockTicket = {
      ...mockTicket,
      status: 'resolved',
      version: mockTicket.version + 1,
      allowedTransitions: ['closed'],
    };
    const response: ResolveTicketResponse = { data: mockTicket, traceId: 'trace-mock-003' };
    return HttpResponse.json(response);
  }),
];
