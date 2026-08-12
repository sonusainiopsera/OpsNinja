/**
 * drift-detector.spec.ts — unit tests for detectDrift, buildSyntheticEventId,
 * buildSyntheticEnvelope and decidePendingRepair (WO-057 AC10).
 *
 * All functions are pure — no mocks required.
 */

import {
  detectDrift,
  buildSyntheticEventId,
  buildSyntheticEnvelope,
  decidePendingRepair,
  type JiraSearchIssue,
  type CachedLinkState,
} from './drift-detector';
import {
  makeJiraIssue,
  makeJiraIssueStatusChanged,
  makeJiraIssueAssigneeChanged,
  makeJiraIssueUnchanged,
  makeCachedLink,
  CACHED_LINK_NO_DRIFT,
  CACHED_LINK_STATUS_DRIFT,
  CACHED_LINK_ASSIGNEE_DRIFT,
  CACHED_LINK_NO_UPDATED_AT,
  SYNTHETIC_EVENT_ID_PREFIX,
} from '../../test/fixtures/jira-search.fixtures';

// ---------------------------------------------------------------------------
// buildSyntheticEventId — determinism and stability
// ---------------------------------------------------------------------------

describe('buildSyntheticEventId', () => {
  it('returns a string prefixed with "recon:"', () => {
    const id = buildSyntheticEventId('10001', '2024-06-01T10:00:00.000+0000');
    expect(id).toMatch(/^recon:/);
  });

  it('is deterministic: same inputs → same output', () => {
    const a = buildSyntheticEventId('10001', '2024-06-01T10:00:00.000+0000');
    const b = buildSyntheticEventId('10001', '2024-06-01T10:00:00.000+0000');
    expect(a).toBe(b);
  });

  it('differs when issue id changes', () => {
    const a = buildSyntheticEventId('10001', '2024-06-01T10:00:00.000+0000');
    const b = buildSyntheticEventId('99999', '2024-06-01T10:00:00.000+0000');
    expect(a).not.toBe(b);
  });

  it('differs when updated timestamp changes', () => {
    const a = buildSyntheticEventId('10001', '2024-06-01T10:00:00.000+0000');
    const b = buildSyntheticEventId('10001', '2024-06-02T10:00:00.000+0000');
    expect(a).not.toBe(b);
  });

  it('produces a fixed-length string (recon: + 32 hex chars)', () => {
    const id = buildSyntheticEventId('10001', '2024-06-01T10:00:00.000+0000');
    expect(id).toHaveLength('recon:'.length + 32);
  });

  it('matches SYNTHETIC_EVENT_ID_PREFIX constant from fixtures', () => {
    const id = buildSyntheticEventId('10001', '2024-06-01T10:00:00.000+0000');
    expect(id.startsWith(SYNTHETIC_EVENT_ID_PREFIX)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectDrift — drift classification
// ---------------------------------------------------------------------------

describe('detectDrift', () => {
  it('returns hasDrift=false when nothing has changed', () => {
    const issue = makeJiraIssueUnchanged();
    const result = detectDrift(issue, CACHED_LINK_NO_DRIFT);
    expect(result.hasDrift).toBe(false);
    expect(result.driftedFields).toHaveLength(0);
  });

  it('detects status drift only', () => {
    const issue = makeJiraIssueStatusChanged();
    const result = detectDrift(issue, CACHED_LINK_STATUS_DRIFT);
    expect(result.hasDrift).toBe(true);
    expect(result.driftedFields).toContain('status');
  });

  it('detects assignee drift only', () => {
    const issue = makeJiraIssueAssigneeChanged();
    const result = detectDrift(issue, CACHED_LINK_ASSIGNEE_DRIFT);
    expect(result.hasDrift).toBe(true);
    expect(result.driftedFields).toContain('assignee');
  });

  it('detects updated timestamp drift when Jira is newer', () => {
    const issue = makeJiraIssue({
      fields: {
        summary: 'Test',
        updated: '2024-06-02T00:00:00.000+0000', // newer
        status: { id: '10002', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        assignee: { displayName: 'Jane Dev', accountId: 'acc-jane' },
        resolution: null,
      },
    });
    const cached = makeCachedLink({ jiraUpdatedAt: new Date('2024-06-01T00:00:00.000Z') });
    const result = detectDrift(issue, cached);
    expect(result.driftedFields).toContain('updated');
  });

  it('treats missing cached updated_at as drift (first sync)', () => {
    const issue = makeJiraIssueUnchanged();
    const result = detectDrift(issue, CACHED_LINK_NO_UPDATED_AT);
    expect(result.hasDrift).toBe(true);
    expect(result.driftedFields).toContain('updated');
  });

  it('detects multiple fields drifted simultaneously', () => {
    const issue = makeJiraIssueStatusChanged(); // status + timestamp changed
    const result = detectDrift(issue, CACHED_LINK_STATUS_DRIFT);
    expect(result.driftedFields).toContain('status');
    expect(result.driftedFields).toContain('updated');
  });

  it('does NOT flag updated when cached date equals Jira date', () => {
    const issue = makeJiraIssueUnchanged(); // updated = '2024-06-01T10:00:00.000+0000'
    const cached = makeCachedLink({
      jiraUpdatedAt: new Date('2024-06-01T10:00:00.000Z'),
      jiraStatus: 'In Progress',
      jiraAssignee: 'Jane Dev',
    });
    const result = detectDrift(issue, cached);
    expect(result.driftedFields).not.toContain('updated');
  });

  it('does NOT flag updated when cached date is newer (clock skew — no false drift)', () => {
    const issue = makeJiraIssueUnchanged(); // updated = '2024-06-01T10:00:00.000+0000'
    const cached = makeCachedLink({
      jiraUpdatedAt: new Date('2024-06-02T00:00:00.000Z'), // cached is newer
      jiraStatus: 'In Progress',
      jiraAssignee: 'Jane Dev',
    });
    const result = detectDrift(issue, cached);
    expect(result.driftedFields).not.toContain('updated');
  });

  it('comparison is case-insensitive for status', () => {
    const issue = makeJiraIssue({
      fields: {
        summary: 'Test',
        updated: '2024-06-01T10:00:00.000+0000',
        status: { id: '10002', name: 'in progress', statusCategory: { key: 'indeterminate' } },
        assignee: { displayName: 'Jane Dev', accountId: 'acc-jane' },
        resolution: null,
      },
    });
    const cached = makeCachedLink({ jiraStatus: 'In Progress' });
    const result = detectDrift(issue, cached);
    expect(result.driftedFields).not.toContain('status');
  });

  it('handles null assignee on both sides without flagging drift', () => {
    const issue = makeJiraIssue({
      fields: {
        summary: 'Test',
        updated: '2024-06-01T10:00:00.000+0000',
        status: { id: '10002', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        assignee: null,
        resolution: null,
      },
    });
    const cached = makeCachedLink({ jiraAssignee: null });
    const result = detectDrift(issue, cached);
    expect(result.driftedFields).not.toContain('assignee');
  });

  it('flags assignee drift when Jira sets assignee and cached is null', () => {
    const issue = makeJiraIssue(); // has assignee
    const cached = makeCachedLink({ jiraAssignee: null });
    const result = detectDrift(issue, cached);
    expect(result.driftedFields).toContain('assignee');
  });

  it('always includes a syntheticEventId in the result', () => {
    const issue = makeJiraIssueUnchanged();
    const result = detectDrift(issue, CACHED_LINK_NO_DRIFT);
    expect(result.syntheticEventId).toMatch(/^recon:/);
  });

  it('syntheticEventId is deterministic across runs', () => {
    const issue = makeJiraIssueUnchanged();
    const r1 = detectDrift(issue, CACHED_LINK_NO_DRIFT);
    const r2 = detectDrift(issue, CACHED_LINK_NO_DRIFT);
    expect(r1.syntheticEventId).toBe(r2.syntheticEventId);
  });
});

// ---------------------------------------------------------------------------
// buildSyntheticEnvelope — payload shape
// ---------------------------------------------------------------------------

describe('buildSyntheticEnvelope', () => {
  it('returns eventType jira:issue_updated', () => {
    const issue = makeJiraIssueStatusChanged();
    const { driftedFields } = detectDrift(issue, CACHED_LINK_STATUS_DRIFT);
    const env = buildSyntheticEnvelope(issue, CACHED_LINK_STATUS_DRIFT, driftedFields);
    expect(env.eventType).toBe('jira:issue_updated');
  });

  it('matches the issue id and key', () => {
    const issue = makeJiraIssueStatusChanged();
    const { driftedFields } = detectDrift(issue, CACHED_LINK_STATUS_DRIFT);
    const env = buildSyntheticEnvelope(issue, CACHED_LINK_STATUS_DRIFT, driftedFields);
    expect(env.jiraIssueId).toBe(issue.id);
    expect(env.jiraIssueKey).toBe(issue.key);
  });

  it('marks payload as synthetic', () => {
    const issue = makeJiraIssueStatusChanged();
    const { driftedFields } = detectDrift(issue, CACHED_LINK_STATUS_DRIFT);
    const env = buildSyntheticEnvelope(issue, CACHED_LINK_STATUS_DRIFT, driftedFields);
    expect(env.payload['_synthetic']).toBe(true);
  });

  it('includes drift fields in payload', () => {
    const issue = makeJiraIssueStatusChanged();
    const { driftedFields } = detectDrift(issue, CACHED_LINK_STATUS_DRIFT);
    const env = buildSyntheticEnvelope(issue, CACHED_LINK_STATUS_DRIFT, driftedFields);
    expect(env.payload['_reconDriftFields']).toEqual(driftedFields);
  });

  it('eventId matches buildSyntheticEventId', () => {
    const issue = makeJiraIssueStatusChanged();
    const { driftedFields } = detectDrift(issue, CACHED_LINK_STATUS_DRIFT);
    const env = buildSyntheticEnvelope(issue, CACHED_LINK_STATUS_DRIFT, driftedFields);
    const expected = buildSyntheticEventId(issue.id, issue.fields.updated);
    expect(env.eventId).toBe(expected);
  });

  it('includes tenantId from cached link', () => {
    const issue = makeJiraIssueStatusChanged();
    const { driftedFields } = detectDrift(issue, CACHED_LINK_STATUS_DRIFT);
    const env = buildSyntheticEnvelope(issue, CACHED_LINK_STATUS_DRIFT, driftedFields);
    expect(env.tenantId).toBe(CACHED_LINK_STATUS_DRIFT.tenantId);
  });
});

// ---------------------------------------------------------------------------
// decidePendingRepair — decision tree
// ---------------------------------------------------------------------------

describe('decidePendingRepair', () => {
  it('returns repair action when a Jira issue is found', () => {
    const issue = makeJiraIssue();
    const decision = decidePendingRepair(issue, 0);
    expect(decision.action).toBe('repair');
    if (decision.action === 'repair') {
      expect(decision.jiraIssueId).toBe(issue.id);
      expect(decision.jiraIssueKey).toBe(issue.key);
    }
  });

  it('returns reemit action when no issue found and reemitCount is 0', () => {
    const decision = decidePendingRepair(null, 0);
    expect(decision.action).toBe('reemit');
  });

  it('returns fail action when no issue found and reemitCount > 0', () => {
    const decision = decidePendingRepair(null, 1);
    expect(decision.action).toBe('fail');
    if (decision.action === 'fail') {
      expect(decision.reason).toBe('pending_unresolvable');
    }
  });

  it('returns fail when reemitCount is large', () => {
    const decision = decidePendingRepair(null, 99);
    expect(decision.action).toBe('fail');
  });

  it('prefers repair even when reemitCount > 0 (issue found takes priority)', () => {
    const issue = makeJiraIssue();
    const decision = decidePendingRepair(issue, 5);
    expect(decision.action).toBe('repair');
  });
});
