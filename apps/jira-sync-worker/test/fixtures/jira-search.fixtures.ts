/**
 * Fixtures for reconciliation job tests (WO-057).
 *
 * Provides Jira search API response pages and cached link rows for every
 * drift class: status-only, assignee-only, timestamp-only, no-change,
 * pending (stale), and 404 (orphaned).
 */

import type { JiraSearchIssue, CachedLinkState } from '../../src/reconciliation/drift-detector';

// ---------------------------------------------------------------------------
// Fixed UUIDs
// ---------------------------------------------------------------------------

export const TENANT_ID      = 'aaaaaaaa-0000-0000-0000-000000000001';
export const CONNECTION_ID  = 'bbbbbbbb-0000-0000-0000-000000000001';
export const MAPPING_ID     = 'cccccccc-0000-0000-0000-000000000001';
export const TICKET_ID      = 'dddddddd-0000-0000-0000-000000000001';
export const LINK_ID        = 'eeeeeeee-0000-0000-0000-000000000001';
export const LINK_ID_2      = 'eeeeeeee-0000-0000-0000-000000000002';
export const LINK_ID_PEND   = 'eeeeeeee-0000-0000-0000-000000000003';

// ---------------------------------------------------------------------------
// Jira issue factories
// ---------------------------------------------------------------------------

export function makeJiraIssue(overrides: Partial<JiraSearchIssue> = {}): JiraSearchIssue {
  return {
    id: '10001',
    key: 'PLAT-42',
    fields: {
      summary: 'Something is broken',
      updated: '2024-06-01T10:00:00.000+0000',
      status: { id: '10002', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { displayName: 'Jane Dev', accountId: 'acc-jane' },
      resolution: null,
    },
    ...overrides,
  };
}

export function makeJiraIssueStatusChanged(): JiraSearchIssue {
  return makeJiraIssue({
    fields: {
      summary: 'Something is broken',
      updated: '2024-06-01T12:00:00.000+0000',
      status: { id: '10003', name: 'Done', statusCategory: { key: 'done' } },
      assignee: { displayName: 'Jane Dev', accountId: 'acc-jane' },
      resolution: { name: 'Fixed' },
    },
  });
}

export function makeJiraIssueAssigneeChanged(): JiraSearchIssue {
  return makeJiraIssue({
    fields: {
      summary: 'Something is broken',
      updated: '2024-06-01T11:00:00.000+0000',
      status: { id: '10002', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { displayName: 'Bob Ops', accountId: 'acc-bob' },
      resolution: null,
    },
  });
}

export function makeJiraIssueUnchanged(): JiraSearchIssue {
  return makeJiraIssue(); // matches the cached link below
}

// ---------------------------------------------------------------------------
// Jira search page factory
// ---------------------------------------------------------------------------

export interface MockSearchPage {
  total: number;
  maxResults: number;
  startAt: number;
  issues: JiraSearchIssue[];
}

export function makeSearchPage(issues: JiraSearchIssue[], startAt = 0): MockSearchPage {
  return {
    total: issues.length,
    maxResults: 100,
    startAt,
    issues,
  };
}

/** Multi-page fixture: two pages of results */
export const PAGE_1_ISSUES = [makeJiraIssueStatusChanged()];
export const PAGE_2_ISSUES = [makeJiraIssueAssigneeChanged()];

export function makePage1(): MockSearchPage {
  return { total: 101, maxResults: 100, startAt: 0, issues: PAGE_1_ISSUES };
}

export function makePage2(): MockSearchPage {
  return { total: 101, maxResults: 100, startAt: 100, issues: PAGE_2_ISSUES };
}

// ---------------------------------------------------------------------------
// Cached link factories
// ---------------------------------------------------------------------------

export function makeCachedLink(overrides: Partial<CachedLinkState> = {}): CachedLinkState {
  return {
    linkId: LINK_ID,
    ticketId: TICKET_ID,
    tenantId: TENANT_ID,
    connectionId: CONNECTION_ID,
    jiraIssueId: '10001',
    jiraIssueKey: 'PLAT-42',
    projectKey: 'PLAT',
    jiraStatus: 'In Progress',
    jiraAssignee: 'Jane Dev',
    jiraUpdatedAt: new Date('2024-06-01T10:00:00.000Z'),
    linkState: 'linked',
    mappingId: MAPPING_ID,
    ...overrides,
  };
}

/** Cached link matching makeJiraIssueUnchanged — no drift */
export const CACHED_LINK_NO_DRIFT = makeCachedLink();

/** Cached link with stale status (Jira says Done, we have In Progress) */
export const CACHED_LINK_STATUS_DRIFT = makeCachedLink({
  jiraStatus: 'In Progress',
  jiraUpdatedAt: new Date('2024-06-01T10:00:00.000Z'),
});

/** Cached link with stale assignee */
export const CACHED_LINK_ASSIGNEE_DRIFT = makeCachedLink({
  jiraAssignee: 'Jane Dev',
  jiraUpdatedAt: new Date('2024-06-01T10:00:00.000Z'),
});

/** Cached link with no prior updated timestamp */
export const CACHED_LINK_NO_UPDATED_AT = makeCachedLink({
  jiraUpdatedAt: null,
});

// ---------------------------------------------------------------------------
// Expected synthetic event ids (pre-computed for assertions)
// The id is: 'recon:' + first 32 chars of sha256(issueId + ':' + updatedAt)
// ---------------------------------------------------------------------------

// We don't hardcode the hash — tests call buildSyntheticEventId directly.
// These exports let tests assert the id starts with 'recon:'.
export const SYNTHETIC_EVENT_ID_PREFIX = 'recon:';
