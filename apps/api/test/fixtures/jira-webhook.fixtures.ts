/**
 * Jira webhook payload fixtures — WO-054.
 *
 * Six captured real-shape Jira Cloud webhook payloads plus a signing helper
 * that produces the correct X-Hub-Signature and X-OpsNinja-Timestamp headers.
 *
 * Payload ids use predictable integers so dedupe tests are reproducible.
 * Sensitive fields (reporter email, etc.) are replaced with placeholder values.
 */

import { createHmac } from 'crypto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

export const WEBHOOK_TEST_TENANT_SLUG = 'acme-corp';
export const WEBHOOK_TEST_TENANT_ID = 'f2000001-0000-0000-0000-000000000001';
export const WEBHOOK_TEST_CONNECTION_ID = 'f2000002-0000-0000-0000-000000000001';
export const WEBHOOK_TEST_CLOUD_ID = 'cloud-abc-123';
export const WEBHOOK_TEST_SECRET = 'whs_test_secret_32bytes_padding00';
export const WEBHOOK_TEST_PREVIOUS_SECRET = 'whs_prev_secret_32bytes_padding00';

// ---------------------------------------------------------------------------
// Signing helper
// ---------------------------------------------------------------------------

/**
 * Build the HMAC headers for a test webhook delivery.
 * Matches the receiver's verifyJiraWebhookSignature logic exactly.
 */
export function signWebhookPayload(
  rawBody: Buffer | string,
  secret: string = WEBHOOK_TEST_SECRET,
  unixTimestamp: number = Math.floor(Date.now() / 1000),
): { 'X-Hub-Signature': string; 'X-OpsNinja-Timestamp': string } {
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const signed = Buffer.concat([Buffer.from(`${unixTimestamp}.`), body]);
  const hmac = createHmac('sha256', secret).update(signed).digest('hex');
  return {
    'X-Hub-Signature': `sha256=${hmac}`,
    'X-OpsNinja-Timestamp': String(unixTimestamp),
  };
}

// ---------------------------------------------------------------------------
// Fixture 1: issue_updated — status transition
// ---------------------------------------------------------------------------

export const JIRA_WEBHOOK_ISSUE_UPDATED = {
  id: 100001,
  timestamp: 1712300000000,
  webhookEvent: 'jira:issue_updated',
  issue_event_type_name: 'issue_generic',
  user: {
    accountId: 'user-001',
    displayName: 'Dev User',
    emailAddress: 'dev@example.com',
  },
  issue: {
    id: '10042',
    key: 'OPS-42',
    fields: {
      summary: 'Production outage — cannot connect to DB',
      status: {
        id: '10001',
        name: 'In Progress',
        statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' },
      },
      assignee: { accountId: 'agent-001', displayName: 'Agent One' },
      priority: { name: 'High' },
      updated: '2024-04-05T10:00:00.000+0000',
    },
  },
  changelog: {
    id: '200001',
    items: [
      {
        field: 'status',
        fieldtype: 'jira',
        fromString: 'Open',
        toString: 'In Progress',
      },
    ],
  },
  cloudId: WEBHOOK_TEST_CLOUD_ID,
};

// ---------------------------------------------------------------------------
// Fixture 2: comment_created
// ---------------------------------------------------------------------------

export const JIRA_WEBHOOK_COMMENT_CREATED = {
  id: 100002,
  timestamp: 1712300100000,
  webhookEvent: 'comment_created',
  issue: {
    id: '10042',
    key: 'OPS-42',
    fields: {
      summary: 'Production outage — cannot connect to DB',
      status: { id: '10001', name: 'In Progress' },
    },
  },
  comment: {
    id: '300001',
    author: { accountId: 'agent-001', displayName: 'Agent One' },
    body: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Working on a fix.' }] }],
    },
    created: '2024-04-05T10:01:00.000+0000',
    updated: '2024-04-05T10:01:00.000+0000',
  },
  cloudId: WEBHOOK_TEST_CLOUD_ID,
};

// ---------------------------------------------------------------------------
// Fixture 3: issue_deleted
// ---------------------------------------------------------------------------

export const JIRA_WEBHOOK_ISSUE_DELETED = {
  id: 100003,
  timestamp: 1712300200000,
  webhookEvent: 'jira:issue_deleted',
  issue: {
    id: '10099',
    key: 'OPS-99',
    fields: {
      summary: 'Old duplicate ticket',
      status: { id: '10002', name: 'Done' },
    },
  },
  cloudId: WEBHOOK_TEST_CLOUD_ID,
};

// ---------------------------------------------------------------------------
// Fixture 4: issue_created
// ---------------------------------------------------------------------------

export const JIRA_WEBHOOK_ISSUE_CREATED = {
  id: 100004,
  timestamp: 1712300300000,
  webhookEvent: 'jira:issue_created',
  issue: {
    id: '10050',
    key: 'OPS-50',
    fields: {
      summary: 'New escalation from OpsNinja',
      status: { id: '10000', name: 'Open' },
      priority: { name: 'Medium' },
      created: '2024-04-05T10:05:00.000+0000',
      updated: '2024-04-05T10:05:00.000+0000',
    },
  },
  cloudId: WEBHOOK_TEST_CLOUD_ID,
};

// ---------------------------------------------------------------------------
// Fixture 5: unknown / custom event type (should be persisted as 'ignored')
// ---------------------------------------------------------------------------

export const JIRA_WEBHOOK_UNKNOWN_TYPE = {
  id: 100005,
  timestamp: 1712300400000,
  webhookEvent: 'sprint_started',
  sprint: {
    id: '5001',
    name: 'Sprint 42',
    state: 'active',
  },
  cloudId: WEBHOOK_TEST_CLOUD_ID,
};

// ---------------------------------------------------------------------------
// Fixture 6: issue_updated for an unlinked issue (no ticket_jira_links row)
// ---------------------------------------------------------------------------

export const JIRA_WEBHOOK_UNLINKED_ISSUE = {
  id: 100006,
  timestamp: 1712300500000,
  webhookEvent: 'jira:issue_updated',
  issue: {
    id: '99999',
    key: 'OPS-UNLINKED',
    fields: {
      summary: 'Issue with no OpsNinja link',
      status: { id: '10001', name: 'In Progress' },
    },
  },
  cloudId: WEBHOOK_TEST_CLOUD_ID,
};

// ---------------------------------------------------------------------------
// All six fixtures as an array for batch tests
// ---------------------------------------------------------------------------

export const ALL_WEBHOOK_FIXTURES = [
  JIRA_WEBHOOK_ISSUE_UPDATED,
  JIRA_WEBHOOK_COMMENT_CREATED,
  JIRA_WEBHOOK_ISSUE_DELETED,
  JIRA_WEBHOOK_ISSUE_CREATED,
  JIRA_WEBHOOK_UNKNOWN_TYPE,
  JIRA_WEBHOOK_UNLINKED_ISSUE,
] as const;
