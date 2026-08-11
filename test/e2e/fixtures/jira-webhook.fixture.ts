/**
 * Committed Jira webhook payload fixtures.
 *
 * These are signed webhook payloads that can be replayed against the
 * OpsNinja Jira webhook receiver without a real Jira instance.
 *
 * The HMAC-SHA256 signature is computed with the test secret 'jira-stub-secret'.
 */

import { createHmac } from 'crypto';

const JIRA_STUB_SECRET = 'jira-stub-secret';

function signPayload(body: string): string {
  return 'sha256=' + createHmac('sha256', JIRA_STUB_SECRET).update(body).digest('hex');
}

export const JIRA_WEBHOOK_BODY_TRANSITION = JSON.stringify({
  timestamp: 1700000000,
  webhookEvent: 'jira:issue_updated',
  issue_event_type_name: 'issue_generic',
  issue: {
    key: 'OPSNINJA-1000',
    fields: {
      status: {
        name: 'In Progress',
        statusCategory: { key: 'indeterminate' },
      },
      summary: 'Fixture: SSO authentication failure',
    },
  },
});

export const SIGNED_JIRA_WEBHOOK_TRANSITION = {
  body: JIRA_WEBHOOK_BODY_TRANSITION,
  signature: signPayload(JIRA_WEBHOOK_BODY_TRANSITION),
  headers: {
    'Content-Type': 'application/json',
    'x-hub-signature-256': signPayload(JIRA_WEBHOOK_BODY_TRANSITION),
  },
};

export const JIRA_WEBHOOK_BODY_RESOLVED = JSON.stringify({
  timestamp: 1700000060,
  webhookEvent: 'jira:issue_updated',
  issue_event_type_name: 'issue_generic',
  issue: {
    key: 'OPSNINJA-1000',
    fields: {
      status: {
        name: 'Done',
        statusCategory: { key: 'done' },
      },
      summary: 'Fixture: SSO authentication failure',
    },
  },
});

export const SIGNED_JIRA_WEBHOOK_RESOLVED = {
  body: JIRA_WEBHOOK_BODY_RESOLVED,
  signature: signPayload(JIRA_WEBHOOK_BODY_RESOLVED),
  headers: {
    'Content-Type': 'application/json',
    'x-hub-signature-256': signPayload(JIRA_WEBHOOK_BODY_RESOLVED),
  },
};

/** Fixture for a webhook with a mismatched signature — must be rejected. */
export const JIRA_WEBHOOK_INVALID_SIGNATURE = {
  body: JIRA_WEBHOOK_BODY_TRANSITION,
  headers: {
    'Content-Type': 'application/json',
    'x-hub-signature-256': 'sha256=000000000000000000000000000000000000000000000000000000000000dead',
  },
};
