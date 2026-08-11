/**
 * Multi-tenant ticket fixtures for WO-090 isolation tests.
 *
 * Seeds:
 *   - Tenant A, Organization 1 — portal user's scope
 *   - Tenant A, Organization 2 — same tenant, different org (cross-org attack)
 *   - Tenant B, Organization 3 — different tenant (cross-tenant attack)
 *
 * Each org has tickets with both public and internal comments, plus SLA timer
 * fixtures in running / paused / breached states.
 *
 * Used by:
 *   - portal-ticket-isolation.spec.ts  (isolation guarantees)
 */

import type { Ticket, TicketComment, TicketAttachment, TicketStatusHistory } from '@opsninja/db';
import type { PortalPrincipal } from '../../src/modules/identity/portal/portal-principal';

// ---------------------------------------------------------------------------
// Deterministic UUIDs
// ---------------------------------------------------------------------------

// Tenants
export const TENANT_A = 'aa000000-0000-0000-0000-000000000001';
export const TENANT_B = 'bb000000-0000-0000-0000-000000000001';

// Organizations
export const ORG_A1 = 'aa000000-0000-0001-0000-000000000001'; // tenant A, org 1 (portal user's org)
export const ORG_A2 = 'aa000000-0000-0001-0000-000000000002'; // tenant A, org 2
export const ORG_B1 = 'bb000000-0000-0001-0000-000000000001'; // tenant B, org 1

// Users
export const PORTAL_USER_A1   = 'aa000000-0000-0002-0000-000000000001';
export const AGENT_USER_A     = 'aa000000-0000-0002-0000-000000000002';

// Tickets
export const TICKET_A1_OPEN   = 'aa000000-0000-0003-0000-000000000001'; // org A1, open
export const TICKET_A1_CLOSED = 'aa000000-0000-0003-0000-000000000002'; // org A1, closed
export const TICKET_A2        = 'aa000000-0000-0003-0000-000000000003'; // org A2 (cross-org)
export const TICKET_B1        = 'bb000000-0000-0003-0000-000000000001'; // tenant B (cross-tenant)

// Comments
export const COMMENT_PUBLIC_A1_1   = 'aa000000-0000-0004-0000-000000000001';
export const COMMENT_PUBLIC_A1_2   = 'aa000000-0000-0004-0000-000000000002';
export const COMMENT_INTERNAL_A1_1 = 'aa000000-0000-0004-0000-000000000003';
export const COMMENT_A2_PUBLIC     = 'aa000000-0000-0004-0000-000000000004';

// Attachments
export const ATTACHMENT_A1_PUBLIC   = 'aa000000-0000-0005-0000-000000000001';
export const ATTACHMENT_A1_INTERNAL = 'aa000000-0000-0005-0000-000000000002';

const BASE_DATE = new Date('2026-01-15T10:00:00Z');
const DATE_T1   = new Date('2026-01-15T10:01:00Z');

// ---------------------------------------------------------------------------
// Portal principals
// ---------------------------------------------------------------------------

/** Portal principal bound to Tenant A, Org 1 — the legitimate user */
export const PORTAL_PRINCIPAL_A1: PortalPrincipal = {
  tenantId:           TENANT_A,
  userId:             PORTAL_USER_A1,
  principalKind:      'portal',
  roles:              ['portal_user'],
  orgScopeIds:        [ORG_A1],
  traceId:            'fixture-trace-a1-001',
  boundOrganizationId: ORG_A1,
};

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export const TICKET_A1_OPEN_ROW: Ticket = {
  id:               TICKET_A1_OPEN,
  tenantId:         TENANT_A,
  organizationId:   ORG_A1,
  subject:          'Login issue on mobile app',
  description:      'Cannot login after updating the app.',
  status:           'open',
  priority:         'P2',
  version:          1,
  requesterContactId: PORTAL_USER_A1,
  assigneeId:       null,
  assignmentGroupId: null,
  categoryId:       null,
  aiSummary:        null,
  aiStatus:         null,
  affectedAreaTags: null,
  requestedPriority: 'P2',
  firstResponseAt:  null,
  resolvedAt:       null,
  createdAt:        BASE_DATE,
  updatedAt:        BASE_DATE,
} as unknown as Ticket;

export const TICKET_A1_CLOSED_ROW: Ticket = {
  ...TICKET_A1_OPEN_ROW,
  id:        TICKET_A1_CLOSED,
  subject:   'Old billing query — resolved',
  status:    'closed',
  resolvedAt: DATE_T1,
} as unknown as Ticket;

/** Ticket belonging to org A2 — out-of-scope for PORTAL_PRINCIPAL_A1 */
export const TICKET_A2_ROW: Ticket = {
  ...TICKET_A1_OPEN_ROW,
  id:             TICKET_A2,
  organizationId: ORG_A2,
  subject:        'A2 org ticket — should never appear to A1 portal user',
} as unknown as Ticket;

/** Ticket belonging to Tenant B — cross-tenant, must always return 404 */
export const TICKET_B1_ROW: Ticket = {
  ...TICKET_A1_OPEN_ROW,
  id:             TICKET_B1,
  tenantId:       TENANT_B,
  organizationId: ORG_B1,
  subject:        'Tenant B ticket — must never be readable by tenant A',
} as unknown as Ticket;

export const ALL_TICKETS = [
  TICKET_A1_OPEN_ROW,
  TICKET_A1_CLOSED_ROW,
  TICKET_A2_ROW,
  TICKET_B1_ROW,
];

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const COMMENT_PUBLIC_A1_ROW_1: TicketComment = {
  id:             COMMENT_PUBLIC_A1_1,
  tenantId:       TENANT_A,
  ticketId:       TICKET_A1_OPEN,
  organizationId: ORG_A1,
  authorId:       PORTAL_USER_A1,
  body:           'I tried restarting — still broken.',
  visibility:     'public',
  createdAt:      BASE_DATE,
  updatedAt:      BASE_DATE,
} as unknown as TicketComment;

export const COMMENT_PUBLIC_A1_ROW_2: TicketComment = {
  id:             COMMENT_PUBLIC_A1_2,
  tenantId:       TENANT_A,
  ticketId:       TICKET_A1_OPEN,
  organizationId: ORG_A1,
  authorId:       null, // agent reply
  body:           'We are investigating and will update you shortly.',
  visibility:     'public',
  createdAt:      DATE_T1,
  updatedAt:      DATE_T1,
} as unknown as TicketComment;

/** Internal comment — must NEVER appear in portal responses */
export const COMMENT_INTERNAL_A1_ROW: TicketComment = {
  id:             COMMENT_INTERNAL_A1_1,
  tenantId:       TENANT_A,
  ticketId:       TICKET_A1_OPEN,
  organizationId: ORG_A1,
  authorId:       AGENT_USER_A,
  body:           'INTERNAL: Auth service regression, customer is affected. ETA 2h.',
  visibility:     'internal',
  createdAt:      DATE_T1,
  updatedAt:      DATE_T1,
} as unknown as TicketComment;

export const ALL_COMMENTS_TICKET_A1 = [
  COMMENT_PUBLIC_A1_ROW_1,
  COMMENT_PUBLIC_A1_ROW_2,
  COMMENT_INTERNAL_A1_ROW,
];

export const PUBLIC_COMMENTS_TICKET_A1 = [
  COMMENT_PUBLIC_A1_ROW_1,
  COMMENT_PUBLIC_A1_ROW_2,
];

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export const ATTACHMENT_PUBLIC_ROW: TicketAttachment = {
  id:             ATTACHMENT_A1_PUBLIC,
  tenantId:       TENANT_A,
  ticketId:       TICKET_A1_OPEN,
  commentId:      COMMENT_PUBLIC_A1_1,
  organizationId: ORG_A1,
  filename:       'screenshot.png',
  mimeType:       'image/png',
  s3Key:          `${TENANT_A}/attachments/${ATTACHMENT_A1_PUBLIC}.png`,
  isFinalized:    true,
  createdAt:      BASE_DATE,
} as unknown as TicketAttachment;

export const ATTACHMENT_INTERNAL_ROW: TicketAttachment = {
  id:             ATTACHMENT_A1_INTERNAL,
  tenantId:       TENANT_A,
  ticketId:       TICKET_A1_OPEN,
  commentId:      COMMENT_INTERNAL_A1_1,
  organizationId: ORG_A1,
  filename:       'internal-trace.log',
  mimeType:       'text/plain',
  s3Key:          `${TENANT_A}/attachments/${ATTACHMENT_A1_INTERNAL}.log`,
  isFinalized:    true,
  createdAt:      BASE_DATE,
} as unknown as TicketAttachment;

// ---------------------------------------------------------------------------
// Status history
// ---------------------------------------------------------------------------

export const STATUS_HISTORY_A1: TicketStatusHistory[] = [
  {
    id:          'aa000000-0000-0006-0000-000000000001',
    tenantId:    TENANT_A,
    ticketId:    TICKET_A1_OPEN,
    fromStatus:  null,
    toStatus:    'open',
    actorUserId: null,
    reason:      'portal_submission',
    createdAt:   BASE_DATE,
  } as TicketStatusHistory,
  {
    id:          'aa000000-0000-0006-0000-000000000002',
    tenantId:    TENANT_A,
    ticketId:    TICKET_A1_OPEN,
    fromStatus:  'open',
    toStatus:    'in_progress',
    actorUserId: AGENT_USER_A,
    reason:      null,
    createdAt:   DATE_T1,
  } as TicketStatusHistory,
];

// ---------------------------------------------------------------------------
// SLA timer fixture shapes (used to mock SlaQueryService)
// ---------------------------------------------------------------------------

export const SLA_RESULT_RUNNING = {
  ticketId: TICKET_A1_OPEN,
  clocks: [
    {
      clockType:   'response' as const,
      state:       'running' as const,
      targetAt:    '2026-01-15T14:00:00Z',
      startedAt:   '2026-01-15T10:00:00Z',
      elapsedMs:   3_600_000,
      remainingMs: 10_800_000,
      pausedMs:    0,
      elapsedPct:  25,
      thresholds:  { first: 50, second: 75 },
      computedAt:  '2026-01-15T11:00:00Z',
    },
    {
      clockType:   'resolution' as const,
      state:       'running' as const,
      targetAt:    '2026-01-17T10:00:00Z',
      startedAt:   '2026-01-15T10:00:00Z',
      elapsedMs:   3_600_000,
      remainingMs: 169_200_000,
      pausedMs:    0,
      elapsedPct:  2.08,
      thresholds:  { first: 50, second: 75 },
      computedAt:  '2026-01-15T11:00:00Z',
    },
  ],
};

export const SLA_RESULT_BREACHED = {
  ticketId: TICKET_A1_OPEN,
  clocks: [
    {
      clockType:   'response' as const,
      state:       'breached' as const,
      targetAt:    '2026-01-15T12:00:00Z',
      startedAt:   '2026-01-15T10:00:00Z',
      elapsedMs:   7_200_000,
      remainingMs: 0,
      pausedMs:    0,
      elapsedPct:  100,
      thresholds:  { first: 50, second: 75 },
      computedAt:  '2026-01-15T13:00:00Z',
    },
  ],
};

export const SLA_RESULT_PAUSED = {
  ticketId: TICKET_A1_OPEN,
  clocks: [
    {
      clockType:   'response' as const,
      state:       'paused' as const,
      targetAt:    '2026-01-15T16:00:00Z',
      startedAt:   '2026-01-15T10:00:00Z',
      elapsedMs:   3_600_000,
      remainingMs: 14_400_000,
      pausedMs:    1_800_000,
      elapsedPct:  20,
      thresholds:  { first: 50, second: 75 },
      computedAt:  '2026-01-15T11:00:00Z',
    },
  ],
};

export const SLA_RESULT_NO_POLICY = {
  ticketId: TICKET_A1_OPEN,
  clocks:   [],
  reason:   'no_policy' as const,
};
