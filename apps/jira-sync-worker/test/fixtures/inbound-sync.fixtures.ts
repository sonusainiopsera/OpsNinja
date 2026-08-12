/**
 * Inbound Jira sync fixtures — WO-055.
 *
 * Deterministic envelope fixtures for every classified event kind:
 *   - issue_updated (status transition)
 *   - comment_created
 *   - comment_updated (edit)
 *   - issue_assignee_changed
 *   - issue_deleted
 *   - OpsNinja-originated comment (loop-prevention fixture)
 *   - Stale event (older jira_updated_at than link)
 *
 * All UUIDs are fixed so test output is reproducible.
 */

import { OPSNINJA_ORIGIN_MARKER } from '../../src/inbound/event-classifier';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

export const JS_TENANT_ID      = 'aaaaaaaa-0000-4000-8000-000000000001';
export const JS_TICKET_ID      = 'bbbbbbbb-0000-4000-8000-000000000001';
export const JS_ORG_ID         = 'cccccccc-0000-4000-8000-000000000001';
export const JS_LINK_ID        = 'dddddddd-0000-4000-8000-000000000001';
export const JS_CONNECTION_ID  = 'eeeeeeee-0000-4000-8000-000000000001';
export const JS_MAPPING_ID     = 'ffffffff-0000-4000-8000-000000000001';

export const JS_JIRA_ISSUE_ID  = '10042';
export const JS_JIRA_ISSUE_KEY = 'OPS-42';

export const JS_INTEGRATION_ACCOUNT_ID = 'svc-opsninja-001';

// ---------------------------------------------------------------------------
// SQS message shape helpers
// ---------------------------------------------------------------------------

export interface JiraInboundSqsMessage {
  tenantId: string;
  jiraEventId: string;
  eventType: string;
}

export function makeInboundMessage(
  overrides: Partial<JiraInboundSqsMessage> = {},
): JiraInboundSqsMessage {
  return {
    tenantId: JS_TENANT_ID,
    jiraEventId: 'evt-001',
    eventType: 'jira:issue_updated',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fixture 1: issue_updated — status transition (In Progress → Done)
// ---------------------------------------------------------------------------

export const FIXTURE_ISSUE_UPDATED_STATUS = {
  id: 'evt-001',
  webhookEvent: 'jira:issue_updated',
  issue: {
    id: JS_JIRA_ISSUE_ID,
    key: JS_JIRA_ISSUE_KEY,
    fields: {
      summary: 'Production outage',
      status: {
        id: '10003',
        name: 'Done',
        statusCategory: { id: 3, key: 'done', name: 'Done' },
      },
      assignee: { accountId: 'eng-001', displayName: 'Alice Engineer' },
      updated: '2024-04-10T14:00:00.000+0000',
    },
  },
  changelog: {
    id: 'cl-001',
    items: [
      { field: 'status', fieldtype: 'jira', fromString: 'In Progress', toString: 'Done' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Fixture 2: comment_created — regular engineer comment
// ---------------------------------------------------------------------------

export const FIXTURE_COMMENT_CREATED = {
  id: 'evt-002',
  webhookEvent: 'comment_created',
  issue: {
    id: JS_JIRA_ISSUE_ID,
    key: JS_JIRA_ISSUE_KEY,
    fields: {
      updated: '2024-04-10T14:05:00.000+0000',
    },
  },
  comment: {
    id: 'jc-001',
    author: { accountId: 'eng-001', displayName: 'Alice Engineer' },
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Fixed the connection pool limit. Deploying now.' }],
        },
      ],
    },
    created: '2024-04-10T14:05:00.000+0000',
    updated: '2024-04-10T14:05:00.000+0000',
  },
};

// ---------------------------------------------------------------------------
// Fixture 3: comment_updated — in-place edit of an existing comment
// ---------------------------------------------------------------------------

export const FIXTURE_COMMENT_UPDATED = {
  id: 'evt-003',
  webhookEvent: 'comment_updated',
  issue: {
    id: JS_JIRA_ISSUE_ID,
    key: JS_JIRA_ISSUE_KEY,
    fields: {
      updated: '2024-04-10T14:10:00.000+0000',
    },
  },
  comment: {
    id: 'jc-001', // same id as FIXTURE_COMMENT_CREATED → in-place update
    author: { accountId: 'eng-001', displayName: 'Alice Engineer' },
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Fixed the connection pool limit. Deployed successfully.' },
          ],
        },
      ],
    },
    created: '2024-04-10T14:05:00.000+0000',
    updated: '2024-04-10T14:10:00.000+0000',
  },
};

// ---------------------------------------------------------------------------
// Fixture 4: issue_updated — assignee change only
// ---------------------------------------------------------------------------

export const FIXTURE_ASSIGNEE_CHANGED = {
  id: 'evt-004',
  webhookEvent: 'jira:issue_updated',
  issue: {
    id: JS_JIRA_ISSUE_ID,
    key: JS_JIRA_ISSUE_KEY,
    fields: {
      summary: 'Production outage',
      status: {
        id: '10001',
        name: 'In Progress',
        statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' },
      },
      assignee: { accountId: 'eng-002', displayName: 'Bob Engineer' },
      updated: '2024-04-10T14:15:00.000+0000',
    },
  },
  changelog: {
    id: 'cl-002',
    items: [
      { field: 'assignee', fieldtype: 'jira', fromString: 'Alice Engineer', toString: 'Bob Engineer' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Fixture 5: issue_deleted
// ---------------------------------------------------------------------------

export const FIXTURE_ISSUE_DELETED = {
  id: 'evt-005',
  webhookEvent: 'jira:issue_deleted',
  issue: {
    id: JS_JIRA_ISSUE_ID,
    key: JS_JIRA_ISSUE_KEY,
    fields: {
      summary: 'Production outage',
      updated: '2024-04-10T15:00:00.000+0000',
    },
  },
};

// ---------------------------------------------------------------------------
// Fixture 6: OpsNinja-originated comment (loop prevention)
// ---------------------------------------------------------------------------

export const FIXTURE_OPSNINJA_LOOP_COMMENT = {
  id: 'evt-006',
  webhookEvent: 'comment_created',
  issue: {
    id: JS_JIRA_ISSUE_ID,
    key: JS_JIRA_ISSUE_KEY,
    fields: {
      updated: '2024-04-10T14:20:00.000+0000',
    },
  },
  comment: {
    id: 'jc-loop-001',
    // This is the OpsNinja integration service account — triggers loop detection
    author: { accountId: JS_INTEGRATION_ACCOUNT_ID, displayName: 'OpsNinja Bot' },
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: `Agent escalated this ticket ${OPSNINJA_ORIGIN_MARKER}` },
          ],
        },
      ],
    },
    created: '2024-04-10T14:20:00.000+0000',
    updated: '2024-04-10T14:20:00.000+0000',
  },
};

// ---------------------------------------------------------------------------
// Fixture 7: Stale event — jira_updated_at is older than link's last_synced
// ---------------------------------------------------------------------------

export const FIXTURE_STALE_EVENT = {
  id: 'evt-007',
  webhookEvent: 'jira:issue_updated',
  issue: {
    id: JS_JIRA_ISSUE_ID,
    key: JS_JIRA_ISSUE_KEY,
    fields: {
      summary: 'Production outage',
      status: {
        id: '10001',
        name: 'In Progress',
        statusCategory: { id: 4, key: 'indeterminate', name: 'In Progress' },
      },
      // Deliberately old — will be rejected as stale when link.jira_updated_at is newer
      updated: '2024-04-01T00:00:00.000+0000',
    },
  },
  changelog: {
    id: 'cl-003',
    items: [
      { field: 'status', fieldtype: 'jira', fromString: 'New', toString: 'In Progress' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Fixture 8: comment with origin marker in body (not author-based loop)
// ---------------------------------------------------------------------------

export const FIXTURE_MARKER_LOOP_COMMENT = {
  id: 'evt-008',
  webhookEvent: 'comment_created',
  issue: {
    id: JS_JIRA_ISSUE_ID,
    key: JS_JIRA_ISSUE_KEY,
    fields: {
      updated: '2024-04-10T14:25:00.000+0000',
    },
  },
  comment: {
    id: 'jc-marker-001',
    // Author is NOT the integration account — loop detection via marker only
    author: { accountId: 'external-eng-999', displayName: 'External Engineer' },
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: `Posted from OpsNinja ${OPSNINJA_ORIGIN_MARKER}` },
          ],
        },
      ],
    },
    created: '2024-04-10T14:25:00.000+0000',
    updated: '2024-04-10T14:25:00.000+0000',
  },
};

// ---------------------------------------------------------------------------
// Reusable DB row factories
// ---------------------------------------------------------------------------

export interface MockLink {
  id: string;
  tenant_id: string;
  ticket_id: string;
  connection_id: string;
  mapping_id: string;
  jira_issue_id: string;
  jira_issue_key: string | null;
  jira_status: string | null;
  jira_assignee: string | null;
  link_state: string;
  orphaned: boolean;
  jira_updated_at: string | null;
}

export function makeLink(overrides: Partial<MockLink> = {}): MockLink {
  return {
    id: JS_LINK_ID,
    tenant_id: JS_TENANT_ID,
    ticket_id: JS_TICKET_ID,
    connection_id: JS_CONNECTION_ID,
    mapping_id: JS_MAPPING_ID,
    jira_issue_id: JS_JIRA_ISSUE_ID,
    jira_issue_key: JS_JIRA_ISSUE_KEY,
    jira_status: 'In Progress',
    jira_assignee: 'Alice Engineer',
    link_state: 'linked',
    orphaned: false,
    jira_updated_at: '2024-04-09T10:00:00.000Z',
    ...overrides,
  };
}

export interface MockConnection {
  id: string;
  state: string;
  integration_account_id: string | null;
}

export function makeConnection(overrides: Partial<MockConnection> = {}): MockConnection {
  return {
    id: JS_CONNECTION_ID,
    state: 'active',
    integration_account_id: JS_INTEGRATION_ACCOUNT_ID,
    ...overrides,
  };
}

export interface MockMapping {
  id: string;
  status_map: Array<{ jiraStatusId?: string; jiraStatusCategory?: string; opsninjaStatus: string }>;
  sync_rules: Record<string, unknown>;
}

export function makeMapping(overrides: Partial<MockMapping> = {}): MockMapping {
  return {
    id: JS_MAPPING_ID,
    status_map: [
      { jiraStatusCategory: 'indeterminate', opsninjaStatus: 'pending_engineering' },
      { jiraStatusCategory: 'done',          opsninjaStatus: 'resolved' },
      { jiraStatusId: '10000',               opsninjaStatus: 'open' },
    ],
    sync_rules: {
      applyInboundStatus: true,
      applyInboundComments: true,
      commentVisibility: 'internal',
      autoResolveOnJiraDone: false,
    },
    ...overrides,
  };
}

export interface MockTicket {
  id: string;
  status: string;
  version: number;
  organization_id: string;
}

export function makeTicket(overrides: Partial<MockTicket> = {}): MockTicket {
  return {
    id: JS_TICKET_ID,
    status: 'open',
    version: 1,
    organization_id: JS_ORG_ID,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// jira_webhook_events envelope factory
// ---------------------------------------------------------------------------

export interface MockEnvelope {
  id: string;
  tenant_id: string;
  jira_event_id: string;
  event_type: string;
  jira_issue_id: string | null;
  jira_issue_key: string | null;
  payload: unknown;
  received_at: string;
  processing_state: string;
  attempts: number;
}

export function makeEnvelope(
  jiraEventId: string,
  eventType: string,
  payload: unknown,
  overrides: Partial<MockEnvelope> = {},
): MockEnvelope {
  return {
    id: `env-${jiraEventId}`,
    tenant_id: JS_TENANT_ID,
    jira_event_id: jiraEventId,
    event_type: eventType,
    jira_issue_id: JS_JIRA_ISSUE_ID,
    jira_issue_key: JS_JIRA_ISSUE_KEY,
    payload,
    received_at: new Date(Date.now() - 3000).toISOString(),
    processing_state: 'pending',
    attempts: 0,
    ...overrides,
  };
}
