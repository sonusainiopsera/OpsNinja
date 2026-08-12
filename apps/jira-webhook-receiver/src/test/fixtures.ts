/**
 * Test fixtures for the Jira webhook receiver — WO-054 AC11.
 *
 * Exports:
 *  - Six captured Jira webhook payloads (issue_updated, comment_created,
 *    issue_deleted, issue_created, comment_updated, comment_deleted).
 *  - A secret-signing helper `buildSignedRequest` for constructing valid
 *    signed HTTP headers in integration and unit tests.
 *  - A `buildResolvedConnection` helper that returns a ResolvedConnection
 *    matching the shared fixture secret.
 */

import { buildJiraWebhookHeaders } from '../signature.verifier';
import type { ResolvedConnection } from '../ingest.service';

// ---------------------------------------------------------------------------
// Shared fixture constants
// ---------------------------------------------------------------------------

export const FIXTURE_TENANT_ID = 'f1000001-0000-0000-0000-000000000001';
export const FIXTURE_CONNECTION_ID = 'f2000001-0000-0000-0000-000000000001';
export const FIXTURE_TENANT_SLUG = 'acme-corp';
export const FIXTURE_SECRET = 'whs_test_secret_32bytes_padding00';
export const FIXTURE_CLOUD_ID = 'cloud-abc-123';

export const FIXTURE_UNIX_TS = 1712300000; // Fixed Unix second for deterministic signatures

// ---------------------------------------------------------------------------
// Signing helper (AC11 — secret-signing test helper)
// ---------------------------------------------------------------------------

/**
 * Build signed HTTP headers for a Jira webhook request.
 * Use in integration tests to construct valid POST requests.
 */
export function buildSignedHeaders(
  body: Buffer | string,
  secret: string = FIXTURE_SECRET,
  ts: number = FIXTURE_UNIX_TS,
): { 'X-Hub-Signature': string; 'X-OpsNinja-Timestamp': string } {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return buildJiraWebhookHeaders(buf, secret, ts);
}

/**
 * Build a ResolvedConnection for the shared fixture tenant.
 */
export function buildResolvedConnection(overrides?: Partial<ResolvedConnection>): ResolvedConnection {
  return {
    tenantId: FIXTURE_TENANT_ID,
    connectionId: FIXTURE_CONNECTION_ID,
    secret: FIXTURE_SECRET,
    previousSecret: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fixture 1: jira:issue_updated
// ---------------------------------------------------------------------------

export const FIXTURE_ISSUE_UPDATED = {
  id: 100001,
  webhookEvent: 'jira:issue_updated',
  timestamp: 1712300000000,
  cloudId: FIXTURE_CLOUD_ID,
  issue: {
    id: '10042',
    key: 'OPS-42',
    fields: {
      summary: 'Deploy OpsNinja v2',
      status: { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { accountId: 'user-abc', displayName: 'Alice Smith' },
      priority: { id: '2', name: 'High' },
      updated: '2024-04-05T10:00:00.000+0000',
    },
  },
  changelog: {
    id: '20001',
    items: [
      { field: 'status', fromString: 'Open', toString: 'In Progress' },
    ],
  },
  matchedWebhookIds: [10001],
} as const;

// ---------------------------------------------------------------------------
// Fixture 2: comment_created
// ---------------------------------------------------------------------------

export const FIXTURE_COMMENT_CREATED = {
  id: 100002,
  webhookEvent: 'comment_created',
  timestamp: 1712300100000,
  cloudId: FIXTURE_CLOUD_ID,
  comment: {
    id: '50001',
    author: { accountId: 'user-abc', displayName: 'Alice Smith' },
    body: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'I am looking into this.' }] }],
    },
    created: '2024-04-05T10:01:00.000+0000',
    updated: '2024-04-05T10:01:00.000+0000',
  },
  issue: { id: '10042', key: 'OPS-42' },
  matchedWebhookIds: [10001],
} as const;

// ---------------------------------------------------------------------------
// Fixture 3: jira:issue_deleted
// ---------------------------------------------------------------------------

export const FIXTURE_ISSUE_DELETED = {
  id: 100003,
  webhookEvent: 'jira:issue_deleted',
  timestamp: 1712300200000,
  cloudId: FIXTURE_CLOUD_ID,
  issue: { id: '10043', key: 'OPS-43' },
  matchedWebhookIds: [10001],
} as const;

// ---------------------------------------------------------------------------
// Fixture 4: jira:issue_created
// ---------------------------------------------------------------------------

export const FIXTURE_ISSUE_CREATED = {
  id: 100004,
  webhookEvent: 'jira:issue_created',
  timestamp: 1712300300000,
  cloudId: FIXTURE_CLOUD_ID,
  issue: {
    id: '10044',
    key: 'OPS-44',
    fields: {
      summary: 'New onboarding flow for v3',
      status: { id: '1', name: 'Open', statusCategory: { key: 'new' } },
      assignee: null,
      priority: { id: '3', name: 'Medium' },
      created: '2024-04-05T10:03:00.000+0000',
      updated: '2024-04-05T10:03:00.000+0000',
    },
  },
  matchedWebhookIds: [10001],
} as const;

// ---------------------------------------------------------------------------
// Fixture 5: comment_updated
// ---------------------------------------------------------------------------

export const FIXTURE_COMMENT_UPDATED = {
  id: 100005,
  webhookEvent: 'comment_updated',
  timestamp: 1712300400000,
  cloudId: FIXTURE_CLOUD_ID,
  comment: {
    id: '50001',
    author: { accountId: 'user-abc', displayName: 'Alice Smith' },
    body: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated: fixed in branch feat/opsninja-v2.' }] }],
    },
    created: '2024-04-05T10:01:00.000+0000',
    updated: '2024-04-05T10:04:00.000+0000',
  },
  issue: { id: '10042', key: 'OPS-42' },
  matchedWebhookIds: [10001],
} as const;

// ---------------------------------------------------------------------------
// Fixture 6: comment_deleted
// ---------------------------------------------------------------------------

export const FIXTURE_COMMENT_DELETED = {
  id: 100006,
  webhookEvent: 'comment_deleted',
  timestamp: 1712300500000,
  cloudId: FIXTURE_CLOUD_ID,
  comment: { id: '50002' },
  issue: { id: '10042', key: 'OPS-42' },
  matchedWebhookIds: [10001],
} as const;

// ---------------------------------------------------------------------------
// Convenience array of all six payloads
// ---------------------------------------------------------------------------

export const ALL_FIXTURES = [
  FIXTURE_ISSUE_UPDATED,
  FIXTURE_COMMENT_CREATED,
  FIXTURE_ISSUE_DELETED,
  FIXTURE_ISSUE_CREATED,
  FIXTURE_COMMENT_UPDATED,
  FIXTURE_COMMENT_DELETED,
] as const;
