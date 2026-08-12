/**
 * jira-dlq.fixtures.ts — outbound Jira sync fixtures (WO-056 AC11).
 *
 * Deterministic test data for:
 *   - DLQ items (fresh, already-replayed, aged-replay-eligible)
 *   - Outbox event payloads per operation type (createIssue, addComment,
 *     transition, updateFields)
 *   - Canned Jira HTTP success/error responses (201, 429+Retry-After, 403, 500)
 */

// ---------------------------------------------------------------------------
// Fixed UUIDs
// ---------------------------------------------------------------------------

export const DLQ_TENANT_ID      = 'aaaaaaaa-0000-4000-8000-000000000010';
export const DLQ_TENANT_ID_B    = 'aaaaaaaa-0000-4000-8000-000000000011';
export const DLQ_LINK_ID        = 'bbbbbbbb-0000-4000-8000-000000000010';
export const DLQ_LINK_ID_2      = 'bbbbbbbb-0000-4000-8000-000000000011';
export const DLQ_TICKET_ID      = 'cccccccc-0000-4000-8000-000000000010';
export const DLQ_CONNECTION_ID  = 'dddddddd-0000-4000-8000-000000000010';
export const DLQ_ITEM_ID        = 'eeeeeeee-0000-4000-8000-000000000010';
export const DLQ_ITEM_ID_2      = 'eeeeeeee-0000-4000-8000-000000000011';
export const DLQ_OPERATOR_ID    = 'ffffffff-0000-4000-8000-000000000010';

// ---------------------------------------------------------------------------
// DLQ item factory
// ---------------------------------------------------------------------------

export interface MockDlqItem {
  id: string;
  tenantId: string;
  linkId: string;
  ticketId: string;
  connectionId: string;
  eventType: string;
  originalPayload: unknown;
  attempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  firstSeenAt: Date;
  lastAttemptAt: Date | null;
  replayedAt: Date | null;
  replayedBy: string | null;
}

export function makeDlqItem(overrides: Partial<MockDlqItem> = {}): MockDlqItem {
  return {
    id: DLQ_ITEM_ID,
    tenantId: DLQ_TENANT_ID,
    linkId: DLQ_LINK_ID,
    ticketId: DLQ_TICKET_ID,
    connectionId: DLQ_CONNECTION_ID,
    eventType: 'jira.link.create',
    originalPayload: { tenantId: DLQ_TENANT_ID, linkId: DLQ_LINK_ID },
    attempts: 6,
    lastErrorCode: 'JIRA_SERVER_ERROR',
    lastErrorMessage: 'Jira internal server error.',
    firstSeenAt: new Date('2024-05-01T10:00:00.000Z'),
    lastAttemptAt: new Date('2024-05-01T12:30:00.000Z'),
    replayedAt: null,
    replayedBy: null,
    ...overrides,
  };
}

/** DLQ item that was already replayed recently (within debounce window). */
export const DLQ_ITEM_REPLAYED_RECENTLY = makeDlqItem({
  id: DLQ_ITEM_ID_2,
  replayedAt: new Date(Date.now() - 60_000), // 1 minute ago — within 5-min debounce
  replayedBy: DLQ_OPERATOR_ID,
});

/** DLQ item eligible for re-replay (replayed >5 min ago). */
export const DLQ_ITEM_REPLAYED_ELIGIBLE = makeDlqItem({
  id: DLQ_ITEM_ID_2,
  replayedAt: new Date(Date.now() - 10 * 60_000), // 10 minutes ago
  replayedBy: DLQ_OPERATOR_ID,
});

/** DLQ item that hit a permanent 403 error. */
export const DLQ_ITEM_FORBIDDEN = makeDlqItem({
  eventType: 'jira.link.create',
  attempts: 1,
  lastErrorCode: 'JIRA_FORBIDDEN',
  lastErrorMessage: 'Jira permission denied. Re-consent may be required.',
});

// ---------------------------------------------------------------------------
// Outbox event payload fixtures per operation type
// ---------------------------------------------------------------------------

export const OUTBOX_CREATE_ISSUE_PAYLOAD = {
  tenantId: DLQ_TENANT_ID,
  linkId: DLQ_LINK_ID,
  ticketId: DLQ_TICKET_ID,
  operation: 'createIssue',
  projectKey: 'OPS',
  summary: 'Production outage — cannot connect to DB',
  description: 'The primary database connection pool is exhausted.',
  issuetype: 'Bug',
};

export const OUTBOX_ADD_COMMENT_PAYLOAD = {
  tenantId: DLQ_TENANT_ID,
  linkId: DLQ_LINK_ID,
  ticketId: DLQ_TICKET_ID,
  operation: 'addComment',
  jiraIssueKey: 'OPS-42',
  body: {
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Agent comment synced from OpsNinja.' }] },
    ],
  },
};

export const OUTBOX_TRANSITION_PAYLOAD = {
  tenantId: DLQ_TENANT_ID,
  linkId: DLQ_LINK_ID,
  ticketId: DLQ_TICKET_ID,
  operation: 'transition',
  jiraIssueKey: 'OPS-42',
  targetStatus: 'In Progress',
  transitionId: '21',
};

export const OUTBOX_UPDATE_FIELDS_PAYLOAD = {
  tenantId: DLQ_TENANT_ID,
  linkId: DLQ_LINK_ID,
  ticketId: DLQ_TICKET_ID,
  operation: 'updateFields',
  jiraIssueKey: 'OPS-42',
  fields: {
    priority: { name: 'High' },
    assignee: { accountId: 'eng-001' },
  },
};

/** All four outbox payload types as an array for parametric tests. */
export const ALL_OUTBOX_PAYLOADS = [
  { type: 'createIssue',  payload: OUTBOX_CREATE_ISSUE_PAYLOAD },
  { type: 'addComment',   payload: OUTBOX_ADD_COMMENT_PAYLOAD },
  { type: 'transition',   payload: OUTBOX_TRANSITION_PAYLOAD },
  { type: 'updateFields', payload: OUTBOX_UPDATE_FIELDS_PAYLOAD },
] as const;

// ---------------------------------------------------------------------------
// Canned Jira HTTP responses
// ---------------------------------------------------------------------------

/** Successful issue creation (201). */
export const JIRA_RESPONSE_CREATE_201 = {
  status: 201,
  body: {
    id: '10042',
    key: 'OPS-42',
    self: 'https://example.atlassian.net/rest/api/3/issue/10042',
  },
};

/** Successful comment addition (201). */
export const JIRA_RESPONSE_COMMENT_201 = {
  status: 201,
  body: {
    id: '300001',
    self: 'https://example.atlassian.net/rest/api/3/issue/10042/comment/300001',
  },
};

/** Successful transition (204 No Content). */
export const JIRA_RESPONSE_TRANSITION_204 = {
  status: 204,
  body: null,
};

/** Successful field update (204 No Content). */
export const JIRA_RESPONSE_UPDATE_204 = {
  status: 204,
  body: null,
};

/** 429 rate limited with Retry-After header. */
export const JIRA_RESPONSE_429_RETRY_AFTER = {
  status: 429,
  headers: { 'retry-after': '30' },
  body: {
    errorMessages: ['Rate limit exceeded. Retry after 30 seconds.'],
    errors: {},
  },
};

/** 403 permission denied (permanent). */
export const JIRA_RESPONSE_403_FORBIDDEN = {
  status: 403,
  body: {
    errorMessages: ['You do not have permission to create issues in this project.'],
    errors: {},
  },
};

/** 500 internal server error (transient — should trigger retry). */
export const JIRA_RESPONSE_500_SERVER_ERROR = {
  status: 500,
  body: {
    errorMessages: ['An internal error occurred.'],
    errors: {},
  },
};

/** 400 validation error on create (permanent). */
export const JIRA_RESPONSE_400_VALIDATION = {
  status: 400,
  body: {
    errorMessages: [],
    errors: { summary: 'Field \'summary\' cannot be empty.' },
  },
};

/** 400 workflow transition invalid (permanent — specific error code). */
export const JIRA_RESPONSE_400_WORKFLOW = {
  status: 400,
  body: {
    errorMessages: [],
    errors: { transition: 'Transition \'In Progress\' is not allowed from current status.' },
  },
};

/** 500 returned twice, then 201 on third attempt (retry success scenario). */
export const JIRA_RESPONSE_SEQUENCE_500_500_201 = [
  JIRA_RESPONSE_500_SERVER_ERROR,
  JIRA_RESPONSE_500_SERVER_ERROR,
  JIRA_RESPONSE_CREATE_201,
];

// ---------------------------------------------------------------------------
// Principal fixtures for DLQ API tests
// ---------------------------------------------------------------------------

export const DLQ_PRINCIPAL_INTEGRATION_ADMIN = {
  userId: DLQ_OPERATOR_ID,
  tenantId: DLQ_TENANT_ID,
  principalKind: 'staff' as const,
  roles: ['integration_admin'],
  orgScopeIds: [] as string[],
  traceId: 'trace-dlq-001',
};

export const DLQ_PRINCIPAL_AGENT = {
  userId: 'agent-user-001',
  tenantId: DLQ_TENANT_ID,
  principalKind: 'staff' as const,
  roles: ['agent'],
  orgScopeIds: [] as string[],
  traceId: 'trace-dlq-002',
};
