/**
 * Test fixtures for WO-053 — Jira Links escalation tests.
 *
 * Exports:
 *   - Deterministic tenant/user/ticket/mapping IDs
 *   - Ticket with mixed public + internal comment thread
 *   - Enabled Jira project mapping with syncRules
 *   - Expected ADF description snapshot (public comments only)
 *   - Expected ADF description snapshot (internal notes included)
 *   - JiraLink row fixture (pending state)
 *   - JiraLink row fixture (linked / failed / unlinked states)
 *   - Principal helpers for agent, portal, cross-tenant agent
 */

import type { PrincipalContext } from '../../src/observability/request-context';
import type {
  TicketContext,
  CommentContext,
} from '../../src/modules/jira/links/jira-payload.builder';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

export const JL_TENANT_A = 'f0530001-0000-0000-0000-000000000001';
export const JL_TENANT_B = 'f0530001-0000-0000-0000-000000000002';

export const JL_AGENT_A  = 'f0530002-0000-0000-0000-000000000001';
export const JL_PORTAL_A = 'f0530002-0000-0000-0000-000000000002';
export const JL_ADMIN_A  = 'f0530002-0000-0000-0000-000000000003';

export const JL_TICKET_ID    = 'f0530003-0000-0000-0000-000000000001';
export const JL_MAPPING_ID   = 'f0530004-0000-0000-0000-000000000001';
export const JL_CONNECTION_ID = 'f0530005-0000-0000-0000-000000000001';
export const JL_LINK_ID      = 'f0530006-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Principals
// ---------------------------------------------------------------------------

export const PRINCIPAL_AGENT_A: PrincipalContext = {
  tenantId: JL_TENANT_A,
  userId: JL_AGENT_A,
  principalKind: 'staff',
  roles: ['agent'],
  orgScopeIds: [],
  traceId: 'trace-jl-agent-001',
};

export const PRINCIPAL_ADMIN_A: PrincipalContext = {
  tenantId: JL_TENANT_A,
  userId: JL_ADMIN_A,
  principalKind: 'staff',
  roles: ['admin'],
  orgScopeIds: [],
  traceId: 'trace-jl-admin-001',
};

export const PRINCIPAL_PORTAL_A: PrincipalContext = {
  tenantId: JL_TENANT_A,
  userId: JL_PORTAL_A,
  principalKind: 'portal',
  roles: ['portal_user'],
  orgScopeIds: [],
  boundOrganizationId: 'f0530007-0000-0000-0000-000000000001',
  traceId: 'trace-jl-portal-001',
};

export const PRINCIPAL_CROSS_TENANT: PrincipalContext = {
  tenantId: JL_TENANT_B,
  userId: 'f0530002-0000-0000-0000-000000000099',
  principalKind: 'staff',
  roles: ['agent'],
  orgScopeIds: [],
  traceId: 'trace-jl-cross-001',
};

// ---------------------------------------------------------------------------
// Jira project mapping fixture (enabled, sync rules)
// ---------------------------------------------------------------------------

export const MAPPING_FIXTURE = {
  id: JL_MAPPING_ID,
  tenantId: JL_TENANT_A,
  connectionId: JL_CONNECTION_ID,
  projectKey: 'PLAT',
  projectName: 'Platform Engineering',
  defaultIssueTypeId: '10001',
  enabled: true,
  fieldMap: [],
  statusMap: [],
  syncRules: {
    applyInboundStatus: true,
    applyInboundComments: false,
    autoResolveOnJiraDone: false,
    /** 'public' = exclude internal notes; 'internal' = include when caller also requests */
    commentVisibility: 'public' as 'public' | 'internal',
  },
};

/** Same mapping but with commentVisibility='internal' (allows internal notes). */
export const MAPPING_FIXTURE_INTERNAL_ALLOWED = {
  ...MAPPING_FIXTURE,
  id: 'f0530004-0000-0000-0000-000000000002',
  syncRules: {
    ...MAPPING_FIXTURE.syncRules,
    commentVisibility: 'internal' as 'public' | 'internal',
  },
};

export const MAPPING_FIXTURE_DISABLED = {
  ...MAPPING_FIXTURE,
  id: 'f0530004-0000-0000-0000-000000000003',
  enabled: false,
};

// ---------------------------------------------------------------------------
// Comment fixtures — mixed public + internal
// ---------------------------------------------------------------------------

export const COMMENT_PUBLIC_1: CommentContext = {
  id: 'f0530008-0000-0000-0000-000000000001',
  body: 'Customer reports login fails intermittently on Chrome 124.',
  visibility: 'public',
  authorName: 'Alice Support',
  createdAt: '2026-08-10T09:00:00.000Z',
};

export const COMMENT_INTERNAL_1: CommentContext = {
  id: 'f0530008-0000-0000-0000-000000000002',
  body: 'Checked auth logs — looks like a session token race. Needs engineering.',
  visibility: 'internal',
  authorName: 'Bob Agent',
  createdAt: '2026-08-10T09:15:00.000Z',
};

export const COMMENT_PUBLIC_2: CommentContext = {
  id: 'f0530008-0000-0000-0000-000000000003',
  body: 'Can you share the exact steps to reproduce?',
  visibility: 'public',
  authorName: 'Alice Support',
  createdAt: '2026-08-10T09:30:00.000Z',
};

/** Very long comment — over MAX_COMMENT_CHARS (2000 chars) to trigger truncation. */
export const COMMENT_OVERSIZED: CommentContext = {
  id: 'f0530008-0000-0000-0000-000000000004',
  body: 'A'.repeat(2500) + ' this should be cut',
  visibility: 'public',
  authorName: 'Carol',
  createdAt: '2026-08-10T10:00:00.000Z',
};

/** Comment with HTML special chars to test escaping. */
export const COMMENT_HTML_SPECIAL: CommentContext = {
  id: 'f0530008-0000-0000-0000-000000000005',
  body: '<script>alert("xss")</script> & "quoted" & \'apos\'',
  visibility: 'public',
  authorName: 'Dave',
  createdAt: '2026-08-10T11:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Ticket context fixture
// ---------------------------------------------------------------------------

export const TICKET_CONTEXT: TicketContext = {
  ticketId: JL_TICKET_ID,
  ticketNumber: 1234,
  ticketUrl: 'https://app.opsninja.io/tickets/' + JL_TICKET_ID,
  subject: 'Login fails intermittently on Chrome 124',
  organizationName: 'Acme Corp',
  priority: 'P1',
  categoryPath: 'Authentication > SSO',
  slaTargetAt: '2026-08-11T09:00:00.000Z',
  comments: [COMMENT_PUBLIC_1, COMMENT_INTERNAL_1, COMMENT_PUBLIC_2],
};

/** Ticket context with no comments. */
export const TICKET_CONTEXT_NO_COMMENTS: TicketContext = {
  ...TICKET_CONTEXT,
  ticketId: 'f0530003-0000-0000-0000-000000000002',
  comments: [],
};

/** Ticket context with only internal notes. */
export const TICKET_CONTEXT_INTERNAL_ONLY: TicketContext = {
  ...TICKET_CONTEXT,
  ticketId: 'f0530003-0000-0000-0000-000000000003',
  comments: [COMMENT_INTERNAL_1],
};

/** Ticket context with oversized comment. */
export const TICKET_CONTEXT_OVERSIZED: TicketContext = {
  ...TICKET_CONTEXT,
  ticketId: 'f0530003-0000-0000-0000-000000000004',
  comments: [COMMENT_OVERSIZED],
};

/** Ticket context with HTML-special characters. */
export const TICKET_CONTEXT_HTML_SPECIAL: TicketContext = {
  ...TICKET_CONTEXT,
  ticketId: 'f0530003-0000-0000-0000-000000000005',
  comments: [COMMENT_HTML_SPECIAL],
};

/** Ticket with no ticket number (uses ID as fallback). */
export const TICKET_CONTEXT_NO_NUMBER: TicketContext = {
  ...TICKET_CONTEXT,
  ticketNumber: null,
  comments: [],
};

// ---------------------------------------------------------------------------
// JiraLink row fixtures (various states)
// ---------------------------------------------------------------------------

export const JIRA_LINK_PENDING = {
  id: JL_LINK_ID,
  tenantId: JL_TENANT_A,
  ticketId: JL_TICKET_ID,
  connectionId: JL_CONNECTION_ID,
  mappingId: JL_MAPPING_ID,
  projectKey: 'PLAT',
  linkState: 'pending',
  mode: 'create',
  jiraIssueId: null,
  jiraIssueKey: null,
  jiraIssueUrl: null,
  jiraStatus: null,
  jiraAssignee: null,
  lastSyncedAt: null,
  errorCode: null,
  errorMessage: null,
  createdBy: JL_AGENT_A,
  createdAt: new Date('2026-08-11T10:00:00.000Z'),
  updatedAt: new Date('2026-08-11T10:00:00.000Z'),
};

export const JIRA_LINK_LINKED = {
  ...JIRA_LINK_PENDING,
  id: 'f0530006-0000-0000-0000-000000000002',
  linkState: 'linked',
  jiraIssueId: '10001',
  jiraIssueKey: 'PLAT-42',
  jiraIssueUrl: 'https://acme.atlassian.net/browse/PLAT-42',
  jiraStatus: 'In Progress',
  jiraAssignee: 'eng@acme.com',
  lastSyncedAt: new Date('2026-08-11T10:05:00.000Z'),
};

export const JIRA_LINK_FAILED = {
  ...JIRA_LINK_PENDING,
  id: 'f0530006-0000-0000-0000-000000000003',
  linkState: 'failed',
  errorCode: 'JIRA_API_ERROR',
  errorMessage: 'Jira returned 503 Service Unavailable',
};

export const JIRA_LINK_UNLINKED = {
  ...JIRA_LINK_PENDING,
  id: 'f0530006-0000-0000-0000-000000000004',
  linkState: 'unlinked',
};

// ---------------------------------------------------------------------------
// Expected ADF snapshot fragments for assertion
// ---------------------------------------------------------------------------

/**
 * The ADF doc must contain these structural properties.
 * Tests use expect.objectContaining() rather than exact snapshots to avoid
 * brittleness from minor formatting changes.
 */
export const ADF_SNAPSHOT_TOP_LEVEL = {
  type: 'doc',
  version: 1,
};

export const ADF_CONTEXT_HEADING = {
  type: 'heading',
  attrs: { level: 2 },
};

export const ADF_COMMENTS_HEADING = {
  type: 'heading',
  attrs: { level: 3 },
};

/** Expected ticket key in an ON-NNNN format. */
export const EXPECTED_TICKET_KEY = 'ON-1234';
