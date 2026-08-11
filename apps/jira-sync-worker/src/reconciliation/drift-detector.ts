/**
 * drift-detector.ts — pure drift comparison and synthetic event generation (WO-057).
 *
 * No I/O, no framework imports. All functions are deterministic given the same
 * inputs so they can be exhaustively unit-tested.
 *
 * Drift classes detected:
 *   status    — jira_status differs from issue.fields.status.name
 *   assignee  — jira_assignee differs from issue.fields.assignee.displayName (or null)
 *   updated   — jira_updated_at is older than issue.fields.updated
 *
 * Synthetic event id:
 *   'recon:' + hex(sha256(issueId + ':' + jiraUpdatedTimestamp))
 *   Deterministic per (issueId, updatedTimestamp) so repeated reconciliation
 *   runs produce the same id and the unique constraint on jira_webhook_events
 *   deduplicate silently.
 *
 * We use a synchronous SHA-256 via Node crypto — no async, no side effects.
 */

import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal Jira issue shape returned by the search API. */
export interface JiraSearchIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    updated: string; // ISO-8601
    status: {
      id: string;
      name: string;
      statusCategory: { key: string };
    };
    assignee: { displayName: string; accountId: string } | null;
    resolution: { name: string } | null;
  };
}

/** Cached link row relevant to drift comparison. */
export interface CachedLinkState {
  linkId: string;
  ticketId: string;
  tenantId: string;
  connectionId: string;
  jiraIssueId: string;
  jiraIssueKey: string;
  projectKey: string;
  jiraStatus: string | null;
  jiraAssignee: string | null;
  jiraUpdatedAt: Date | null;
  linkState: string;
  mappingId: string;
}

export type DriftField = 'status' | 'assignee' | 'updated';

export interface DriftResult {
  /** True when any field differs. */
  hasDrift: boolean;
  /** Which fields drifted. */
  driftedFields: DriftField[];
  /** The deterministic synthetic event id to insert. */
  syntheticEventId: string;
}

export interface SyntheticEventPayload {
  /** jira_event_id column value — deterministic. */
  eventId: string;
  tenantId: string;
  /** Mirrors real webhook event type. */
  eventType: 'jira:issue_updated';
  jiraIssueId: string;
  jiraIssueKey: string;
  /** Full synthetic payload stored in jira_webhook_events.payload. */
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Deterministic synthetic event id
// ---------------------------------------------------------------------------

/**
 * Build a deterministic synthetic event id from (issueId, jiraUpdatedTimestamp).
 * Output: 'recon:' + first 16 hex chars of SHA-256(issueId + ':' + updatedAt)
 *
 * The 16-char prefix provides 64 bits of collision resistance — sufficient for
 * the expected cardinality of issues per tenant per run.
 */
export function buildSyntheticEventId(issueId: string, jiraUpdatedAt: string): string {
  const raw = `${issueId}:${jiraUpdatedAt}`;
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 32);
  return `recon:${hash}`;
}

// ---------------------------------------------------------------------------
// Drift comparison
// ---------------------------------------------------------------------------

/**
 * Compare a Jira search result against the cached link state.
 *
 * @returns DriftResult — hasDrift is false if all compared fields match.
 */
export function detectDrift(
  issue: JiraSearchIssue,
  cached: CachedLinkState,
): DriftResult {
  const driftedFields: DriftField[] = [];

  // Status comparison (case-insensitive; Jira status names can vary)
  const jiraStatusName = issue.fields.status.name ?? '';
  const cachedStatus = cached.jiraStatus ?? '';
  if (jiraStatusName.toLowerCase() !== cachedStatus.toLowerCase()) {
    driftedFields.push('status');
  }

  // Assignee comparison (null vs null is ok; null vs name is drift)
  const jiraAssignee = issue.fields.assignee?.displayName ?? null;
  const cachedAssignee = cached.jiraAssignee ?? null;
  if (jiraAssignee !== cachedAssignee) {
    driftedFields.push('assignee');
  }

  // Updated-at comparison: Jira's updated strictly newer than our cached value
  if (cached.jiraUpdatedAt) {
    const jiraUpdatedMs = Date.parse(issue.fields.updated);
    const cachedUpdatedMs = cached.jiraUpdatedAt.getTime();
    if (isFinite(jiraUpdatedMs) && jiraUpdatedMs > cachedUpdatedMs) {
      driftedFields.push('updated');
    }
  } else {
    // No cached timestamp — treat as drifted (first sync)
    driftedFields.push('updated');
  }

  const syntheticEventId = buildSyntheticEventId(issue.id, issue.fields.updated);

  return {
    hasDrift: driftedFields.length > 0,
    driftedFields,
    syntheticEventId,
  };
}

// ---------------------------------------------------------------------------
// Synthetic envelope builder
// ---------------------------------------------------------------------------

/**
 * Build the jira_webhook_events row payload for a synthesised reconciliation event.
 *
 * The payload mirrors the shape of a real jira:issue_updated webhook so the
 * existing InboundHandler can process it unchanged.
 */
export function buildSyntheticEnvelope(
  issue: JiraSearchIssue,
  cached: CachedLinkState,
  driftedFields: DriftField[],
): SyntheticEventPayload {
  const eventId = buildSyntheticEventId(issue.id, issue.fields.updated);

  const payload: Record<string, unknown> = {
    webhookEvent: 'jira:issue_updated',
    issue_event_type_name: 'issue_generic',
    issue: {
      id: issue.id,
      key: issue.key,
      fields: {
        summary: issue.fields.summary,
        updated: issue.fields.updated,
        status: issue.fields.status,
        assignee: issue.fields.assignee,
        resolution: issue.fields.resolution,
      },
    },
    // Mark as synthetic so the inbound worker can log it differently
    _synthetic: true,
    _reconDriftFields: driftedFields,
    _reconLinkId: cached.linkId,
  };

  return {
    eventId,
    tenantId: cached.tenantId,
    eventType: 'jira:issue_updated',
    jiraIssueId: issue.id,
    jiraIssueKey: issue.key,
    payload,
  };
}

// ---------------------------------------------------------------------------
// Pending-link repair decision
// ---------------------------------------------------------------------------

export type PendingRepairDecision =
  | { action: 'repair'; jiraIssueId: string; jiraIssueKey: string }
  | { action: 'reemit' }
  | { action: 'fail'; reason: string };

/**
 * Decide what to do with a link stuck in 'pending' state.
 *
 * @param foundIssue  Jira issue found by idempotency-marker search (null if none).
 * @param reemitCount How many times the outbound event has already been re-emitted.
 */
export function decidePendingRepair(
  foundIssue: JiraSearchIssue | null,
  reemitCount: number,
): PendingRepairDecision {
  if (foundIssue) {
    // Issue found on Jira — repair the link with the real issue id/key.
    return {
      action: 'repair',
      jiraIssueId: foundIssue.id,
      jiraIssueKey: foundIssue.key,
    };
  }

  // No Jira issue found. Re-emit outbound create exactly once.
  if (reemitCount === 0) {
    return { action: 'reemit' };
  }

  // Already re-emitted once without resolution — give up.
  return { action: 'fail', reason: 'pending_unresolvable' };
}
