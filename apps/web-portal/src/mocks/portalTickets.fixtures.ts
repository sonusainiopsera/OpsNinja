/**
 * Portal ticket mock fixtures — WO-090 AC13.
 *
 * Provides:
 *   - Two-org seed (Org A1 and Org A2) matching the API isolation guarantee
 *   - SLA timer fixtures in running / paused / breached states
 *   - Public comments only (internal comments intentionally absent — never returned by API)
 *   - Status history for TicketDetailPage tests
 *
 * Used by:
 *   - src/__tests__/TicketListPage.test.tsx
 *   - src/__tests__/TicketDetailPage.test.tsx
 */

import type {
  PortalTicketListItem,
  PortalTicketListResponse,
  PortalTicketDetail,
  PortalComment,
  PortalStatusHistory,
  PortalSlaProjection,
} from '../../lib/api/tickets/types';

// ---------------------------------------------------------------------------
// SLA fixtures (AC3, AC13)
// ---------------------------------------------------------------------------

export const SLA_RUNNING: PortalSlaProjection = {
  firstResponseTargetAt: '2026-01-15T14:00:00Z',
  resolutionTargetAt:    '2026-01-17T10:00:00Z',
  state:                 'running',
};

export const SLA_PAUSED: PortalSlaProjection = {
  firstResponseTargetAt: '2026-01-15T16:00:00Z',
  resolutionTargetAt:    '2026-01-18T10:00:00Z',
  state:                 'paused',
};

export const SLA_BREACHED: PortalSlaProjection = {
  firstResponseTargetAt: '2026-01-15T12:00:00Z',
  resolutionTargetAt:    null,
  state:                 'breached',
};

export const SLA_MET: PortalSlaProjection = {
  firstResponseTargetAt: '2026-01-15T14:00:00Z',
  resolutionTargetAt:    '2026-01-17T10:00:00Z',
  state:                 'met',
};

// ---------------------------------------------------------------------------
// Comments (public only — AC7, AC13)
// ---------------------------------------------------------------------------

export const COMMENT_CUSTOMER: PortalComment = {
  id:                  'comment-001',
  authorDisplayName:   'Customer',
  authorType:          'customer',
  body:                'I tried restarting — still broken.',
  createdAt:           '2026-01-15T10:01:00Z',
  attachments:         [],
};

export const COMMENT_AGENT: PortalComment = {
  id:                  'comment-002',
  authorDisplayName:   'Support Agent',
  authorType:          'agent',
  body:                'We are investigating and will update you shortly.',
  createdAt:           '2026-01-15T10:05:00Z',
  attachments:         [
    {
      id:          'att-001',
      displayName: 'screenshot.png',
      sizeBytes:   45_012,
    },
  ],
};

// NOTE: An internal comment (visibility='internal') should NEVER appear here.
// The API layer filters them out before returning to portal users.

// ---------------------------------------------------------------------------
// Status history (AC9, AC13)
// ---------------------------------------------------------------------------

export const STATUS_HISTORY: PortalStatusHistory[] = [
  { from: null,        to: 'open',        at: '2026-01-15T10:00:00Z' },
  { from: 'open',      to: 'in_progress', at: '2026-01-15T10:15:00Z' },
];

// ---------------------------------------------------------------------------
// Ticket list items (AC1, AC13)
// ---------------------------------------------------------------------------

export const TICKET_OPEN: PortalTicketListItem = {
  id:           'ticket-a1-001',
  reference:    'OPS-1001',
  subject:      'Login issue on mobile app',
  status:       'open',
  priority:     'P2',
  categoryPath: 'Mobile > Authentication',
  createdAt:    '2026-01-15T10:00:00Z',
  updatedAt:    '2026-01-15T10:00:00Z',
  sla:          SLA_RUNNING,
};

export const TICKET_CLOSED: PortalTicketListItem = {
  id:           'ticket-a1-002',
  reference:    'OPS-1000',
  subject:      'Old billing query — resolved',
  status:       'closed',
  priority:     'P3',
  categoryPath: 'Billing',
  createdAt:    '2026-01-14T09:00:00Z',
  updatedAt:    '2026-01-14T17:00:00Z',
  sla:          SLA_MET,
};

export const TICKET_BREACHED: PortalTicketListItem = {
  id:           'ticket-a1-003',
  reference:    'OPS-1002',
  subject:      'Production outage — needs urgent attention',
  status:       'in_progress',
  priority:     'P1',
  categoryPath: 'Infrastructure',
  createdAt:    '2026-01-15T08:00:00Z',
  updatedAt:    '2026-01-15T09:00:00Z',
  sla:          SLA_BREACHED,
};

// ---------------------------------------------------------------------------
// List responses (AC1, AC13)
// ---------------------------------------------------------------------------

export const LIST_RESPONSE_WITH_DATA: PortalTicketListResponse = {
  data:       [TICKET_OPEN, TICKET_CLOSED],
  nextCursor: null,
};

export const LIST_RESPONSE_PAGINATED: PortalTicketListResponse = {
  data:       [TICKET_OPEN],
  nextCursor: 'eyJjcmVhdGVkQXQiOiIyMDI2LTAxLTE1VDEwOjAwOjAwWiIsImlkIjoidGlja2V0LWExLTAwMSJ9',
};

export const LIST_RESPONSE_EMPTY: PortalTicketListResponse = {
  data:       [],
  nextCursor: null,
};

// ---------------------------------------------------------------------------
// Ticket detail (AC3, AC13)
// ---------------------------------------------------------------------------

export const DETAIL_OPEN: PortalTicketDetail = {
  id:           TICKET_OPEN.id,
  reference:    TICKET_OPEN.reference,
  subject:      TICKET_OPEN.subject,
  status:       TICKET_OPEN.status,
  priority:     TICKET_OPEN.priority,
  categoryPath: TICKET_OPEN.categoryPath,
  createdAt:    TICKET_OPEN.createdAt,
  updatedAt:    TICKET_OPEN.updatedAt,
  sla:          SLA_RUNNING,
  comments:     [COMMENT_CUSTOMER, COMMENT_AGENT],
  statusHistory: STATUS_HISTORY,
};

export const DETAIL_CLOSED: PortalTicketDetail = {
  ...DETAIL_OPEN,
  id:           TICKET_CLOSED.id,
  reference:    TICKET_CLOSED.reference,
  subject:      TICKET_CLOSED.subject,
  status:       'closed',
  sla:          SLA_MET,
  comments:     [COMMENT_CUSTOMER],
  statusHistory: [
    ...STATUS_HISTORY,
    { from: 'in_progress', to: 'resolved', at: '2026-01-14T16:00:00Z' },
    { from: 'resolved',    to: 'closed',   at: '2026-01-14T17:00:00Z' },
  ],
};

/** Ticket with no public comments — empty-thread edge case (AC3 edge case) */
export const DETAIL_NO_COMMENTS: PortalTicketDetail = {
  ...DETAIL_OPEN,
  id:           'ticket-a1-004',
  subject:      'Silent ticket — only internal notes exist',
  comments:     [],  // internal comments filtered out by API
  statusHistory: [STATUS_HISTORY[0]!],
};
