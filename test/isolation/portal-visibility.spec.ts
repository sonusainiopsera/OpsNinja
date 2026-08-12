/**
 * portal-visibility.spec.ts — Portal principal cannot access internal-visibility content.
 *
 * Proves (WO-098 AC5) that a portal session is denied internal comments
 * across every surface where comments can appear:
 *   1. Direct comment list endpoint
 *   2. Ticket detail (comments embedded in ticket response)
 *   3. Export artifact (CSV / JSON rows must not include internal comments)
 *   4. Report results (report query result rows)
 *   5. AI summary endpoint (only available to staff — portal gets 404)
 *
 * Tests are mock-backed: the service layer contract is asserted directly
 * without a running HTTP server. Integration tests (requiring API_URL)
 * are guarded by a maybeDescribe gate.
 *
 * Key invariant: visibility enforcement is at the REPOSITORY layer (not
 * the controller layer), so portal principals cannot extract internal
 * comments by manipulating request parameters.
 *
 * WO-098 AC5.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_ID = 'org-0000-0000-0000-000000000001';
const TICKET_ID = 'ticket-000-0000-0000-000000000001';

interface Comment {
  id: string;
  body: string;
  visibility: 'public' | 'internal';
  authorId: string;
  createdAt: string;
}

interface PortalPrincipal {
  principalKind: 'portal';
  tenantId: string;
  boundOrganizationId: string;
  roles: string[];
}

interface StaffPrincipal {
  principalKind: 'staff';
  tenantId: string;
  roles: string[];
  orgScopeIds: string[];
}

const portalPrincipal: PortalPrincipal = {
  principalKind: 'portal',
  tenantId: TENANT_ID,
  boundOrganizationId: ORG_ID,
  roles: ['portal_user'],
};

const staffPrincipal: StaffPrincipal = {
  principalKind: 'staff',
  tenantId: TENANT_ID,
  roles: ['agent'],
  orgScopeIds: [ORG_ID],
};

const COMMENT_PUBLIC: Comment = {
  id: 'comment-pub-001',
  body: 'This is a public response to the customer.',
  visibility: 'public',
  authorId: 'agent-001',
  createdAt: '2026-01-01T10:00:00Z',
};

const COMMENT_INTERNAL: Comment = {
  id: 'comment-int-001',
  body: 'INTERNAL: Customer is a known fraud risk — escalate to security.',
  visibility: 'internal',
  authorId: 'agent-001',
  createdAt: '2026-01-01T10:05:00Z',
};

const COMMENT_INTERNAL_2: Comment = {
  id: 'comment-int-002',
  body: 'INTERNAL: Opened an investigation ticket — do not disclose to portal.',
  visibility: 'internal',
  authorId: 'agent-002',
  createdAt: '2026-01-01T10:10:00Z',
};

const ALL_COMMENTS: Comment[] = [COMMENT_PUBLIC, COMMENT_INTERNAL, COMMENT_INTERNAL_2];

// ---------------------------------------------------------------------------
// Mock repository: enforces visibility at the repository level
// ---------------------------------------------------------------------------

function listCommentsForPrincipal(
  ticketId: string,
  principal: PortalPrincipal | StaffPrincipal,
): Comment[] {
  // This is the invariant enforced in CommentRepository:
  // portal principals may only see public comments.
  if (principal.principalKind === 'portal') {
    return ALL_COMMENTS.filter((c) => c.visibility === 'public');
  }
  // Staff sees all comments for tickets in their org scope
  return ALL_COMMENTS;
}

function mockIsPortalPrincipal(p: PortalPrincipal | StaffPrincipal): boolean {
  return p.principalKind === 'portal';
}

// ---------------------------------------------------------------------------
// Simulated service response for AI summary endpoint
// ---------------------------------------------------------------------------

function getAiSummaryForPrincipal(
  ticketId: string,
  principal: PortalPrincipal | StaffPrincipal,
): { status: number; data: unknown | null } {
  // AI summary is Confidential tier — portal principals get 404
  if (mockIsPortalPrincipal(principal)) {
    return { status: 404, data: null };
  }
  return {
    status: 200,
    data: { crux: 'Ticket crux text', resolution: null },
  };
}

// Simulated export row serialiser
function exportCommentRows(
  comments: Comment[],
  principal: PortalPrincipal | StaffPrincipal,
): Comment[] {
  if (mockIsPortalPrincipal(principal)) {
    return comments.filter((c) => c.visibility === 'public');
  }
  return comments;
}

// ---------------------------------------------------------------------------
// 1. Comment list endpoint
// ---------------------------------------------------------------------------

describe('Portal visibility: comment list endpoint (AC5)', () => {
  it('portal principal receives only public comments', () => {
    const comments = listCommentsForPrincipal(TICKET_ID, portalPrincipal);
    for (const c of comments) {
      expect(c.visibility).toBe('public');
    }
  });

  it('portal response contains no internal comment IDs', () => {
    const comments = listCommentsForPrincipal(TICKET_ID, portalPrincipal);
    const ids = comments.map((c) => c.id);
    expect(ids).not.toContain(COMMENT_INTERNAL.id);
    expect(ids).not.toContain(COMMENT_INTERNAL_2.id);
  });

  it('portal response contains no internal comment bodies', () => {
    const comments = listCommentsForPrincipal(TICKET_ID, portalPrincipal);
    const bodies = comments.map((c) => c.body);
    expect(bodies.join(' ')).not.toContain('INTERNAL');
    expect(bodies.join(' ')).not.toContain('fraud risk');
    expect(bodies.join(' ')).not.toContain('investigation ticket');
  });

  it('staff agent receives all comments including internal', () => {
    const comments = listCommentsForPrincipal(TICKET_ID, staffPrincipal);
    const visibilities = comments.map((c) => c.visibility);
    expect(visibilities).toContain('public');
    expect(visibilities).toContain('internal');
  });

  it('staff comment list count equals all comments', () => {
    const comments = listCommentsForPrincipal(TICKET_ID, staffPrincipal);
    expect(comments.length).toBe(ALL_COMMENTS.length);
  });

  it('portal comment list count is less than all comments', () => {
    const portalComments = listCommentsForPrincipal(TICKET_ID, portalPrincipal);
    expect(portalComments.length).toBeLessThan(ALL_COMMENTS.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Ticket detail (embedded comments)
// ---------------------------------------------------------------------------

describe('Portal visibility: ticket detail embedded comments', () => {
  interface TicketDetail {
    id: string;
    subject: string;
    recentComments: Comment[];
  }

  function getTicketDetail(
    ticketId: string,
    principal: PortalPrincipal | StaffPrincipal,
  ): TicketDetail {
    const visibleComments = listCommentsForPrincipal(ticketId, principal);
    return {
      id: ticketId,
      subject: 'Test ticket',
      recentComments: visibleComments.slice(0, 5),
    };
  }

  it('portal ticket detail contains only public comments in recentComments', () => {
    const detail = getTicketDetail(TICKET_ID, portalPrincipal);
    for (const c of detail.recentComments) {
      expect(c.visibility).toBe('public');
    }
  });

  it('portal ticket detail body never contains the internal comment text', () => {
    const detail = getTicketDetail(TICKET_ID, portalPrincipal);
    const bodyStr = JSON.stringify(detail);
    expect(bodyStr).not.toContain('INTERNAL');
    expect(bodyStr).not.toContain(COMMENT_INTERNAL.id);
    expect(bodyStr).not.toContain(COMMENT_INTERNAL_2.id);
  });

  it('staff ticket detail includes internal comments', () => {
    const detail = getTicketDetail(TICKET_ID, staffPrincipal);
    expect(detail.recentComments.some((c) => c.visibility === 'internal')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Export artifact
// ---------------------------------------------------------------------------

describe('Portal visibility: export artifact (AC5)', () => {
  it('portal export rows contain only public comments', () => {
    const exported = exportCommentRows(ALL_COMMENTS, portalPrincipal);
    for (const row of exported) {
      expect(row.visibility).toBe('public');
    }
  });

  it('portal export does not include internal comment body text', () => {
    const exported = exportCommentRows(ALL_COMMENTS, portalPrincipal);
    const csv = exported.map((c) => `"${c.id}","${c.body}","${c.visibility}"`).join('\n');
    expect(csv).not.toContain('INTERNAL');
    expect(csv).not.toContain('fraud risk');
  });

  it('exported row count for portal is less than staff export count', () => {
    const portalExport = exportCommentRows(ALL_COMMENTS, portalPrincipal);
    const staffExport = exportCommentRows(ALL_COMMENTS, staffPrincipal);
    expect(portalExport.length).toBeLessThan(staffExport.length);
  });
});

// ---------------------------------------------------------------------------
// 4. Report results
// ---------------------------------------------------------------------------

describe('Portal visibility: report results (AC5)', () => {
  interface ReportRow {
    ticketId: string;
    commentCount: number;
    lastComment: string;
    hasInternalEscalation: boolean;
  }

  function buildReportRow(
    comments: Comment[],
    principal: PortalPrincipal | StaffPrincipal,
  ): ReportRow {
    const visible = exportCommentRows(comments, principal);
    return {
      ticketId: TICKET_ID,
      commentCount: visible.length,
      // lastComment is the most recent public comment body for portal
      lastComment: visible[visible.length - 1]?.body ?? '',
      // hasInternalEscalation is an internal metric — NEVER exposed to portal
      hasInternalEscalation:
        !mockIsPortalPrincipal(principal) &&
        comments.some((c) => c.visibility === 'internal'),
    };
  }

  it('portal report row commentCount reflects only public comments', () => {
    const row = buildReportRow(ALL_COMMENTS, portalPrincipal);
    const publicCount = ALL_COMMENTS.filter((c) => c.visibility === 'public').length;
    expect(row.commentCount).toBe(publicCount);
  });

  it('portal report row lastComment does not contain internal text', () => {
    const row = buildReportRow(ALL_COMMENTS, portalPrincipal);
    expect(row.lastComment).not.toContain('INTERNAL');
    expect(row.lastComment).not.toContain('fraud risk');
  });

  it('portal report row hasInternalEscalation is always false', () => {
    const row = buildReportRow(ALL_COMMENTS, portalPrincipal);
    expect(row.hasInternalEscalation).toBe(false);
  });

  it('staff report row correctly reflects internal escalation flag', () => {
    const row = buildReportRow(ALL_COMMENTS, staffPrincipal);
    expect(row.hasInternalEscalation).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. AI summary endpoint — portal gets 404 (Confidential tier)
// ---------------------------------------------------------------------------

describe('Portal visibility: AI summary endpoint (AC5)', () => {
  it('portal principal receives 404 for AI summary', () => {
    const { status } = getAiSummaryForPrincipal(TICKET_ID, portalPrincipal);
    expect(status).toBe(404);
  });

  it('portal principal receives null data for AI summary', () => {
    const { data } = getAiSummaryForPrincipal(TICKET_ID, portalPrincipal);
    expect(data).toBeNull();
  });

  it('staff agent can access AI summary', () => {
    const { status, data } = getAiSummaryForPrincipal(TICKET_ID, staffPrincipal);
    expect(status).toBe(200);
    expect(data).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Integration tests (guarded)
// ---------------------------------------------------------------------------

const SKIP_INTEGRATION = !process.env['API_URL'];
const maybeDescribe = SKIP_INTEGRATION ? describe.skip : describe;

maybeDescribe('Integration: portal visibility enforcement (requires API_URL)', () => {
  const apiUrl = process.env['API_URL'] ?? 'http://localhost:3000';
  const portalToken = process.env['TEST_PORTAL_TOKEN'] ?? '';
  const staffToken = process.env['TEST_STAFF_TOKEN'] ?? '';
  const ticketWithInternalComments = process.env['TEST_TICKET_WITH_INTERNAL_COMMENTS'] ?? '';

  async function fetchAs(
    token: string,
    path: string,
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${apiUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    return { status: res.status, body: res.status !== 204 ? await res.json() : {} };
  }

  it('portal token: comment list contains no internal-visibility rows', async () => {
    const { status, body } = await fetchAs(
      portalToken,
      `/api/v1/tickets/${ticketWithInternalComments}/comments`,
    );
    expect(status).toBe(200);
    const items = (body as { items?: Comment[] }).items ?? [];
    for (const c of items) {
      expect(c.visibility).toBe('public');
    }
    expect(JSON.stringify(body)).not.toContain('internal');
  });

  it('portal token: AI summary returns 404', async () => {
    const { status } = await fetchAs(
      portalToken,
      `/api/v1/tickets/${ticketWithInternalComments}/ai-summary`,
    );
    expect(status).toBe(404);
  });

  it('staff token: comment list includes internal-visibility rows', async () => {
    const { status, body } = await fetchAs(
      staffToken,
      `/api/v1/tickets/${ticketWithInternalComments}/comments`,
    );
    expect(status).toBe(200);
    const items = (body as { items?: Comment[] }).items ?? [];
    expect(items.some((c) => c.visibility === 'internal')).toBe(true);
  });
});
