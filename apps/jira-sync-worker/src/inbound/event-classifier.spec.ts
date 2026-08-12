/**
 * event-classifier.spec.ts — unit tests for classifyJiraEvent (WO-055 AC10).
 *
 * Pure-function tests: no I/O, no mocking required.
 * Covers: mapped transition, unmapped status, auto-resolve gating, comment
 * mirroring, loop prevention (account + marker), stale-event rejection.
 */

import {
  classifyJiraEvent,
  OPSNINJA_ORIGIN_MARKER,
} from './event-classifier';
import type { ClassifiedEvent } from './event-classifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_INTEGRATION_ACCOUNT = 'svc-opsninja-001';
const OLDER_DATE = new Date('2024-04-09T10:00:00.000Z');
const NEWER_DATE = new Date('2024-04-10T14:00:00.000Z');

function makeIssueUpdatedPayload(
  statusId: string,
  statusName: string,
  categoryKey: string,
  updatedTs = '2024-04-10T14:00:00.000+0000',
  changelogFields: string[] = ['status'],
) {
  return {
    issue: {
      id: '10042',
      key: 'OPS-42',
      fields: {
        summary: 'Test issue',
        status: { id: statusId, name: statusName, statusCategory: { key: categoryKey } },
        assignee: { accountId: 'eng-001', displayName: 'Alice' },
        updated: updatedTs,
      },
    },
    changelog: {
      id: 'cl-001',
      items: changelogFields.map((f) => ({ field: f, fieldtype: 'jira' })),
    },
  };
}

function makeCommentPayload(
  commentId: string,
  authorAccountId: string,
  authorDisplayName: string,
  bodyText: string,
  updatedTs = '2024-04-10T14:05:00.000+0000',
) {
  return {
    issue: {
      id: '10042',
      key: 'OPS-42',
      fields: { updated: updatedTs },
    },
    comment: {
      id: commentId,
      author: { accountId: authorAccountId, displayName: authorDisplayName },
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: bodyText }] }],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Issue updated — status classification
// ---------------------------------------------------------------------------

describe('classifyJiraEvent — issue_updated / status', () => {
  it('classifies status change (In Progress) correctly', () => {
    const payload = makeIssueUpdatedPayload('10001', 'In Progress', 'indeterminate');
    const result = classifyJiraEvent(
      'jira:issue_updated', payload as Record<string, unknown>,
      TENANT_INTEGRATION_ACCOUNT, null,
    );

    expect(result.kind).toBe('issue_status_changed');
    expect(result.jiraStatus).toMatchObject({
      id: '10001',
      name: 'In Progress',
      categoryKey: 'indeterminate',
    });
    expect(result.isLoopOrigin).toBe(false);
    expect(result.isStale).toBe(false);
  });

  it('classifies "Done" status category key correctly', () => {
    const payload = makeIssueUpdatedPayload('10003', 'Done', 'done');
    const result = classifyJiraEvent(
      'jira:issue_updated', payload as Record<string, unknown>,
      null, null,
    );
    expect(result.jiraStatus?.categoryKey).toBe('done');
  });

  it('classifies assignee-only changelog as issue_assignee_changed', () => {
    const payload = makeIssueUpdatedPayload('10001', 'In Progress', 'indeterminate',
      '2024-04-10T14:00:00.000+0000', ['assignee']);
    const result = classifyJiraEvent(
      'jira:issue_updated', payload as Record<string, unknown>,
      null, null,
    );
    expect(result.kind).toBe('issue_assignee_changed');
    expect(result.jiraAssignee).toBe('Alice');
  });

  it('classifies status+assignee mixed changelog as issue_status_changed', () => {
    const payload = makeIssueUpdatedPayload('10001', 'In Progress', 'indeterminate',
      '2024-04-10T14:00:00.000+0000', ['status', 'assignee']);
    const result = classifyJiraEvent(
      'jira:issue_updated', payload as Record<string, unknown>,
      null, null,
    );
    expect(result.kind).toBe('issue_status_changed');
  });

  it('classifies issue_created as issue_status_changed (no changelog)', () => {
    const payload = {
      issue: {
        id: '10050',
        key: 'OPS-50',
        fields: {
          status: { id: '10000', name: 'Open', statusCategory: { key: 'new' } },
          updated: '2024-04-10T14:00:00.000+0000',
        },
      },
    };
    const result = classifyJiraEvent(
      'jira:issue_created', payload as Record<string, unknown>,
      null, null,
    );
    expect(result.kind).toBe('issue_status_changed');
  });
});

// ---------------------------------------------------------------------------
// Issue deleted
// ---------------------------------------------------------------------------

describe('classifyJiraEvent — issue_deleted', () => {
  it('classifies jira:issue_deleted correctly', () => {
    const payload = {
      issue: { id: '10042', key: 'OPS-42', fields: { updated: '2024-04-10T15:00:00.000+0000' } },
    };
    const result = classifyJiraEvent(
      'jira:issue_deleted', payload as Record<string, unknown>,
      null, null,
    );
    expect(result.kind).toBe('issue_deleted');
    expect(result.isLoopOrigin).toBe(false);
    expect(result.isStale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Comment events
// ---------------------------------------------------------------------------

describe('classifyJiraEvent — comment_created', () => {
  it('classifies regular comment_created', () => {
    const payload = makeCommentPayload('jc-001', 'eng-001', 'Alice', 'Deployed fix.');
    const result = classifyJiraEvent(
      'comment_created', payload as Record<string, unknown>,
      TENANT_INTEGRATION_ACCOUNT, null,
    );

    expect(result.kind).toBe('comment_created');
    expect(result.comment).toMatchObject({
      id: 'jc-001',
      authorAccountId: 'eng-001',
      authorDisplayName: 'Alice',
      isEdit: false,
    });
    expect(result.isLoopOrigin).toBe(false);
  });

  it('classifies comment_updated as isEdit=true', () => {
    const payload = makeCommentPayload('jc-001', 'eng-001', 'Alice', 'Updated fix.');
    const result = classifyJiraEvent(
      'comment_updated', payload as Record<string, unknown>,
      TENANT_INTEGRATION_ACCOUNT, null,
    );
    expect(result.kind).toBe('comment_updated');
    expect(result.comment?.isEdit).toBe(true);
  });

  it('returns unsupported for missing comment node', () => {
    const result = classifyJiraEvent(
      'comment_created', { issue: { id: '10042' } } as Record<string, unknown>,
      null, null,
    );
    expect(result.kind).toBe('unsupported');
  });
});

// ---------------------------------------------------------------------------
// Loop prevention — author match
// ---------------------------------------------------------------------------

describe('classifyJiraEvent — loop prevention (author)', () => {
  it('marks isLoopOrigin when comment author is integration account', () => {
    const payload = makeCommentPayload(
      'jc-loop', TENANT_INTEGRATION_ACCOUNT, 'OpsNinja Bot',
      'Ticket escalated from OpsNinja.',
    );
    const result = classifyJiraEvent(
      'comment_created', payload as Record<string, unknown>,
      TENANT_INTEGRATION_ACCOUNT, null,
    );
    expect(result.isLoopOrigin).toBe(true);
    expect(result.loopReason).toBe('author_is_integration_account');
    expect(result.kind).toBe('comment_created');
  });

  it('does NOT mark loop when integrationAccountId is null', () => {
    const payload = makeCommentPayload('jc-001', 'eng-001', 'Alice', 'Working on it.');
    const result = classifyJiraEvent(
      'comment_created', payload as Record<string, unknown>,
      null, null,
    );
    expect(result.isLoopOrigin).toBe(false);
  });

  it('does NOT mark loop when author differs from integration account', () => {
    const payload = makeCommentPayload('jc-001', 'external-eng', 'External', 'LGTM');
    const result = classifyJiraEvent(
      'comment_created', payload as Record<string, unknown>,
      TENANT_INTEGRATION_ACCOUNT, null,
    );
    expect(result.isLoopOrigin).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Loop prevention — origin marker in body
// ---------------------------------------------------------------------------

describe('classifyJiraEvent — loop prevention (origin marker)', () => {
  it('marks isLoopOrigin when comment body contains OPSNINJA_ORIGIN_MARKER', () => {
    const payload = makeCommentPayload(
      'jc-marker', 'external-eng', 'External',
      `Agent escalated. ${OPSNINJA_ORIGIN_MARKER}`,
    );
    const result = classifyJiraEvent(
      'comment_created', payload as Record<string, unknown>,
      TENANT_INTEGRATION_ACCOUNT, null,
    );
    expect(result.isLoopOrigin).toBe(true);
    expect(result.loopReason).toBe('opsninja_origin_marker');
  });

  it('detects marker even when author is not integration account', () => {
    const payload = makeCommentPayload(
      'jc-marker2', 'other-user', 'Other',
      `Some text ${OPSNINJA_ORIGIN_MARKER} more text`,
    );
    const result = classifyJiraEvent(
      'comment_created', payload as Record<string, unknown>,
      'different-account-id', null,
    );
    expect(result.isLoopOrigin).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stale-event detection
// ---------------------------------------------------------------------------

describe('classifyJiraEvent — stale-event rejection', () => {
  it('marks isStale when jiraUpdatedAt is strictly older than linkJiraUpdatedAt', () => {
    // Event ts: 2024-04-01 (old), link ts: 2024-04-10 (newer)
    const oldTs = '2024-04-01T00:00:00.000+0000';
    const payload = makeIssueUpdatedPayload('10001', 'In Progress', 'indeterminate', oldTs);
    const result = classifyJiraEvent(
      'jira:issue_updated', payload as Record<string, unknown>,
      null,
      NEWER_DATE,
    );
    expect(result.isStale).toBe(true);
  });

  it('does NOT mark stale when jiraUpdatedAt equals linkJiraUpdatedAt', () => {
    const sameTs = OLDER_DATE.toISOString();
    const payload = makeIssueUpdatedPayload('10001', 'In Progress', 'indeterminate', sameTs);
    const result = classifyJiraEvent(
      'jira:issue_updated', payload as Record<string, unknown>,
      null, OLDER_DATE,
    );
    // Equal timestamp → not strictly older → not stale
    expect(result.isStale).toBe(false);
  });

  it('does NOT mark stale when jiraUpdatedAt is newer', () => {
    const payload = makeIssueUpdatedPayload(
      '10001', 'In Progress', 'indeterminate',
      NEWER_DATE.toISOString(),
    );
    const result = classifyJiraEvent(
      'jira:issue_updated', payload as Record<string, unknown>,
      null, OLDER_DATE,
    );
    expect(result.isStale).toBe(false);
  });

  it('does NOT mark stale when linkJiraUpdatedAt is null (first sync)', () => {
    const payload = makeIssueUpdatedPayload(
      '10001', 'In Progress', 'indeterminate',
      '2024-04-01T00:00:00.000+0000',
    );
    const result = classifyJiraEvent(
      'jira:issue_updated', payload as Record<string, unknown>,
      null, null,
    );
    expect(result.isStale).toBe(false);
  });

  it('does NOT mark stale when payload has no updated field', () => {
    const payload = {
      issue: {
        id: '10042',
        fields: {
          status: { id: '10001', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          // No updated field
        },
      },
      changelog: { id: 'cl-001', items: [{ field: 'status' }] },
    };
    const result = classifyJiraEvent(
      'jira:issue_updated', payload as Record<string, unknown>,
      null, NEWER_DATE,
    );
    expect(result.isStale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unsupported event type
// ---------------------------------------------------------------------------

describe('classifyJiraEvent — unsupported', () => {
  it('returns kind=unsupported for unknown event types', () => {
    const result = classifyJiraEvent(
      'sprint_started', {} as Record<string, unknown>,
      null, null,
    );
    expect(result.kind).toBe('unsupported');
    expect(result.isLoopOrigin).toBe(false);
    expect(result.isStale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// jiraUpdatedAt extraction
// ---------------------------------------------------------------------------

describe('classifyJiraEvent — jiraUpdatedAt extraction', () => {
  it('parses jiraUpdatedAt from issue.fields.updated', () => {
    const updatedTs = '2024-04-10T14:00:00.000+0000';
    const payload = makeIssueUpdatedPayload('10001', 'In Progress', 'indeterminate', updatedTs);
    const result = classifyJiraEvent(
      'jira:issue_updated', payload as Record<string, unknown>,
      null, null,
    );
    expect(result.jiraUpdatedAt).toBeInstanceOf(Date);
    expect(result.jiraUpdatedAt?.toISOString()).toBe(new Date(updatedTs).toISOString());
  });

  it('returns undefined jiraUpdatedAt when field is missing', () => {
    const result = classifyJiraEvent(
      'jira:issue_deleted', { issue: { id: '1', key: 'OPS-1', fields: {} } } as Record<string, unknown>,
      null, null,
    );
    expect(result.jiraUpdatedAt).toBeUndefined();
  });
});
