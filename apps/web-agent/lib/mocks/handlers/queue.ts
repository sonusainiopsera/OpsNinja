/**
 * MSW handlers for the ticket queue and views endpoints — WO-041.
 *
 * Committed alongside component tests so the queue page runs offline
 * without a live backend. State is held in module-level mutable arrays
 * so tests can inspect or mutate it; call resetQueueHandlers() in afterEach.
 */

import { http, HttpResponse } from 'msw';
import type { TicketRow, TicketListResponse, BulkActionResponse } from '../../api/tickets/types';
import type { SavedView, ViewListResponse, ViewResponse } from '../../api/views/types';
import { SYSTEM_VIEW_IDS } from '../../api/views/types';

// ---------------------------------------------------------------------------
// Fixtures — tickets
// ---------------------------------------------------------------------------

const NOW = '2026-08-11T10:00:00.000Z';
const TARGET_SOON = '2026-08-11T11:00:00.000Z';  // 1h remaining
const TARGET_BREACHED = '2026-08-11T09:00:00.000Z'; // already past

function makeTicket(idx: number): TicketRow {
  const isPriority1 = idx % 20 === 0;
  const isBreached = idx % 15 === 0;
  return {
    id: `ticket-${idx.toString().padStart(4, '0')}`,
    ticketNumber: 10000 + idx,
    subject: `Ticket ${idx}: ${['Login failure', 'Slow response', 'Billing issue', 'Feature request', 'API error'][idx % 5]}`,
    status: (['open', 'in_progress', 'pending_customer', 'pending_engineering', 'open'][idx % 5]) as TicketRow['status'],
    priority: (['P1', 'P2', 'P3', 'P4'][idx % 4]) as TicketRow['priority'],
    categoryId: `cat-${(idx % 4) + 1}`,
    categoryPath: ['Infrastructure / Networking', 'Application / Auth', 'Billing', 'Integrations / API'][idx % 4] ?? null,
    organizationId: `org-${(idx % 3) + 1}`,
    organizationName: ['Acme Corp', 'Globex Corporation', 'Initech'][idx % 3]!,
    assigneeUserId: idx % 3 === 0 ? null : `user-00${(idx % 3) + 1}`,
    assigneeName: idx % 3 === 0 ? null : ['Alice Agent', 'Bob Agent', 'Carol Agent'][idx % 3] ?? null,
    tags: idx % 2 === 0
      ? [{ id: 'tag-1', name: 'urgent' }, { id: 'tag-2', name: 'customer-impact' }]
      : idx % 3 === 0
      ? [{ id: 'tag-3', name: 'regression' }]
      : [],
    hasJiraLink: idx % 4 === 0,
    jiraIssueKey: idx % 4 === 0 ? `OPS-${1000 + idx}` : null,
    sla: {
      targetAt: isBreached ? TARGET_BREACHED : TARGET_SOON,
      pausedMs: 0,
      state: isBreached ? 'breached' : isPriority1 ? 'warning' : 'running',
      serverNow: NOW,
    },
    version: 1,
    createdAt: '2026-08-10T08:00:00Z',
    updatedAt: NOW,
  };
}

// Generate 120 tickets for virtualisation testing
export const MOCK_TICKETS: TicketRow[] = Array.from({ length: 120 }, (_, i) => makeTicket(i + 1));

// ---------------------------------------------------------------------------
// Fixtures — views
// ---------------------------------------------------------------------------

export const MOCK_VIEWS: SavedView[] = [
  {
    id: SYSTEM_VIEW_IDS.ALL_OPEN,
    tenantId: 'ten-001',
    name: 'All Open',
    scope: 'shared',
    pinned: true,
    pinnedOrder: 0,
    isSystem: true,
    filter: null,
    columns: null,
    sort: null,
    sortDir: null,
    ticketCount: 87,
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: SYSTEM_VIEW_IDS.MY_OPEN,
    tenantId: 'ten-001',
    name: 'My Open',
    scope: 'shared',
    pinned: true,
    pinnedOrder: 1,
    isSystem: true,
    filter: null,
    columns: null,
    sort: null,
    sortDir: null,
    ticketCount: 12,
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: SYSTEM_VIEW_IDS.UNASSIGNED,
    tenantId: 'ten-001',
    name: 'Unassigned',
    scope: 'shared',
    pinned: true,
    pinnedOrder: 2,
    isSystem: true,
    filter: null,
    columns: null,
    sort: null,
    sortDir: null,
    ticketCount: 23,
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: SYSTEM_VIEW_IDS.BREACHED_SLA,
    tenantId: 'ten-001',
    name: 'Breached SLA',
    scope: 'shared',
    pinned: true,
    pinnedOrder: 3,
    isSystem: true,
    filter: null,
    columns: null,
    sort: null,
    sortDir: null,
    ticketCount: 8,
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'view-custom-001',
    tenantId: 'ten-001',
    name: 'P1 & P2 Open',
    scope: 'private',
    pinned: true,
    pinnedOrder: 4,
    isSystem: false,
    filter: { type: 'condition', field: 'priority', operator: 'in', value: ['P1', 'P2'] },
    columns: null,
    sort: 'priority',
    sortDir: 'asc',
    ticketCount: 14,
    version: 1,
    createdAt: '2024-06-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Mutable state
// ---------------------------------------------------------------------------

let mockViews = [...MOCK_VIEWS];
let nextViewId = 200;

export function resetQueueHandlers() {
  mockViews = [...MOCK_VIEWS];
  nextViewId = 200;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

export const queueHandlers = [
  // GET /api/v1/tickets — paginated queue
  http.get('/api/v1/tickets', ({ request }) => {
    const url = new URL(request.url);
    const cursor = url.searchParams.get('cursor');
    const limit = parseInt(url.searchParams.get('limit') ?? String(PAGE_SIZE), 10);

    const startIdx = cursor ? parseInt(cursor, 10) : 0;
    const page = MOCK_TICKETS.slice(startIdx, startIdx + limit);
    const nextCursor = startIdx + limit < MOCK_TICKETS.length ? String(startIdx + limit) : null;

    const response: TicketListResponse = {
      data: page,
      nextCursor,
      resultSetVersion: 'v1',
      serverNow: new Date().toISOString(),
      total: MOCK_TICKETS.length,
    };

    return HttpResponse.json(response);
  }),

  // POST /api/v1/tickets/bulk — bulk action
  http.post('/api/v1/tickets/bulk', async ({ request }) => {
    const body = await request.json() as { ticketIds?: string[]; action?: string };
    const ids = body.ticketIds ?? [];

    // Simulate one failure (version conflict) for the last ticket in a batch for testing
    const results = ids.map((id, i) => {
      const isLastAndLong = ids.length >= 3 && i === ids.length - 1;
      if (isLastAndLong) {
        return {
          ticketId: id,
          success: false,
          error: { code: 'VERSION_CONFLICT', message: 'Version conflict — ticket was modified' },
        };
      }
      return { ticketId: id, success: true };
    });

    const response: BulkActionResponse = {
      results,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };

    return HttpResponse.json(response);
  }),

  // GET /api/v1/views — list all views
  http.get('/api/v1/views', () => {
    const response: ViewListResponse = { data: mockViews };
    return HttpResponse.json(response);
  }),

  // POST /api/v1/views — create view
  http.post('/api/v1/views', async ({ request }) => {
    const body = await request.json() as Partial<SavedView>;
    const newView: SavedView = {
      id: `view-${++nextViewId}`,
      tenantId: 'ten-001',
      name: body.name ?? 'New View',
      scope: body.scope ?? 'private',
      pinned: true,
      pinnedOrder: mockViews.length,
      isSystem: false,
      filter: body.filter ?? null,
      columns: body.columns ?? null,
      sort: body.sort ?? null,
      sortDir: body.sortDir ?? null,
      ticketCount: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockViews.push(newView);
    const response: ViewResponse = { data: newView };
    return HttpResponse.json(response, { status: 201 });
  }),

  // PATCH /api/v1/views/:id — update / pin
  http.patch('/api/v1/views/:id', async ({ params, request }) => {
    const idx = mockViews.findIndex((v) => v.id === params['id']);
    if (idx === -1) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'View not found' } },
        { status: 404 },
      );
    }
    const body = await request.json() as Partial<SavedView> & { version?: number };
    if (body.version !== undefined && body.version !== mockViews[idx]!.version) {
      return HttpResponse.json(
        { error: { code: 'VERSION_CONFLICT', message: 'Version conflict' } },
        { status: 409 },
      );
    }
    mockViews[idx] = {
      ...mockViews[idx]!,
      ...body,
      version: mockViews[idx]!.version + 1,
      updatedAt: new Date().toISOString(),
    };
    const response: ViewResponse = { data: mockViews[idx]! };
    return HttpResponse.json(response);
  }),

  // DELETE /api/v1/views/:id
  http.delete('/api/v1/views/:id', ({ params }) => {
    const idx = mockViews.findIndex((v) => v.id === params['id']);
    if (idx === -1) {
      return HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: 'View not found' } },
        { status: 404 },
      );
    }
    mockViews.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),
];
