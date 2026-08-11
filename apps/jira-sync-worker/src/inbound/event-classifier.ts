/**
 * event-classifier.ts — pure-function event classification for inbound Jira sync.
 *
 * No framework dependencies, no I/O.  Receives the raw Jira payload and the
 * tenant connection metadata, and returns a typed classification result that
 * the InboundHandler uses to decide what (if anything) to apply.
 *
 * Loop prevention:
 *   - Comments/transitions authored by the integration service account
 *     (matched via integrationAccountId) are marked as loop origin.
 *   - Comment bodies containing the OPSNINJA_ORIGIN_MARKER are also loop origin.
 *
 * Stale-event detection:
 *   - issue.fields.updated is parsed and compared to linkJiraUpdatedAt.
 *   - If strictly older, the event is marked stale.
 */

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Footer appended to every comment OpsNinja posts to Jira.  Detection of
 *  this marker in an inbound comment means the comment originated in OpsNinja
 *  and must be skipped to prevent the feedback loop. */
export const OPSNINJA_ORIGIN_MARKER = '<!-- opsninja-sync -->';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JiraEventKind =
  | 'issue_status_changed'
  | 'issue_assignee_changed'
  | 'comment_created'
  | 'comment_updated'
  | 'issue_deleted'
  | 'unsupported';

export interface JiraStatusInfo {
  /** Jira status id (numeric string). */
  id: string;
  /** Display name, e.g. "In Progress". */
  name: string;
  /** Status category key: 'new' | 'indeterminate' | 'done' | 'undefined'. */
  categoryKey: string;
}

export interface JiraCommentInfo {
  /** Jira comment id. */
  id: string;
  /** Raw ADF body (may be any JSON value). */
  adfBody: unknown;
  /** Jira account ID of the comment author.  Used for loop detection. */
  authorAccountId: string | undefined;
  /** Display name for attribution in the mirrored comment. */
  authorDisplayName: string | undefined;
  /** True when event_type is comment_updated (mirrors in-place via external_ref). */
  isEdit: boolean;
}

export interface ClassifiedEvent {
  kind: JiraEventKind;
  /** Populated for issue_status_changed. */
  jiraStatus: JiraStatusInfo | undefined;
  /** Jira assignee display name, populated for issue_assignee_changed. */
  jiraAssignee: string | null | undefined;
  /** Populated for comment events. */
  comment: JiraCommentInfo | undefined;
  /** issue.fields.updated as a Date, used for stale-event detection. */
  jiraUpdatedAt: Date | undefined;
  /** True → skip this event, it originated from OpsNinja itself. */
  isLoopOrigin: boolean;
  /** Human-readable reason why this is a loop. */
  loopReason: string | undefined;
  /** True → skip; the event's jiraUpdatedAt is older than the link's last known timestamp. */
  isStale: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getString(obj: unknown, ...path: string[]): string | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function extractTextFromAdf(adf: unknown): string {
  if (typeof adf === 'string') return adf;
  if (!adf || typeof adf !== 'object') return '';
  const doc = adf as Record<string, unknown>;
  const content = doc['content'];
  if (!Array.isArray(content)) return '';
  return content.map((node) => extractTextFromAdf(node)).join('');
}

/**
 * Check whether an ADF (or plain-string) comment body contains the
 * OpsNinja origin marker, which would indicate a loop.
 */
function bodyContainsOriginMarker(adfBody: unknown): boolean {
  const text = extractTextFromAdf(adfBody);
  return text.includes(OPSNINJA_ORIGIN_MARKER);
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

/**
 * Classify a raw Jira webhook payload into a typed event.
 *
 * @param eventType          Raw event type from jira_webhook_events.event_type
 *                           e.g. 'jira:issue_updated', 'comment_created'.
 * @param payload            Full Jira webhook JSON payload.
 * @param integrationAccountId  The Jira account ID of the OpsNinja service
 *                           account; null if not yet populated on the connection.
 * @param linkJiraUpdatedAt  The jira_updated_at timestamp from the current
 *                           ticket_jira_links row; null if never processed.
 */
export function classifyJiraEvent(
  eventType: string,
  payload: Record<string, unknown>,
  integrationAccountId: string | null | undefined,
  linkJiraUpdatedAt: Date | null | undefined,
): ClassifiedEvent {
  // ── Parse issue.fields.updated for ordering ──────────────────────────────
  const updatedStr = getString(payload, 'issue', 'fields', 'updated');
  const jiraUpdatedAt = updatedStr ? new Date(updatedStr) : undefined;

  // ── Stale-event check ────────────────────────────────────────────────────
  const isStale =
    jiraUpdatedAt != null &&
    linkJiraUpdatedAt != null &&
    jiraUpdatedAt < linkJiraUpdatedAt;

  // ── Base result template ──────────────────────────────────────────────────
  const base: ClassifiedEvent = {
    kind: 'unsupported',
    jiraStatus: undefined,
    jiraAssignee: undefined,
    comment: undefined,
    jiraUpdatedAt,
    isLoopOrigin: false,
    loopReason: undefined,
    isStale,
  };

  // ── Route by event type ───────────────────────────────────────────────────
  if (eventType === 'jira:issue_deleted') {
    return { ...base, kind: 'issue_deleted' };
  }

  if (eventType === 'comment_created' || eventType === 'comment_updated') {
    const commentPayload = payload['comment'];
    if (!commentPayload || typeof commentPayload !== 'object') return base;
    const c = commentPayload as Record<string, unknown>;

    const commentId = getString(c, 'id');
    if (!commentId) return base;

    const authorAccountId = getString(c, 'author', 'accountId');
    const authorDisplayName = getString(c, 'author', 'displayName');
    const adfBody = c['body'];

    // Loop detection: author is the integration account
    const authorIsIntegration =
      !!integrationAccountId &&
      !!authorAccountId &&
      authorAccountId === integrationAccountId;

    // Loop detection: body contains origin marker
    const hasOriginMarker = bodyContainsOriginMarker(adfBody);

    const isLoopOrigin = authorIsIntegration || hasOriginMarker;
    const loopReason = isLoopOrigin
      ? authorIsIntegration
        ? 'author_is_integration_account'
        : 'opsninja_origin_marker'
      : undefined;

    return {
      ...base,
      kind: eventType === 'comment_created' ? 'comment_created' : 'comment_updated',
      comment: {
        id: commentId,
        adfBody,
        authorAccountId,
        authorDisplayName,
        isEdit: eventType === 'comment_updated',
      },
      isLoopOrigin,
      loopReason,
    };
  }

  if (eventType === 'jira:issue_updated' || eventType === 'jira:issue_created') {
    const fields = payload['issue'] != null
      ? (payload['issue'] as Record<string, unknown>)['fields']
      : payload['fields'];

    if (!fields || typeof fields !== 'object') {
      return { ...base, kind: 'issue_status_changed' };
    }
    const f = fields as Record<string, unknown>;

    // Extract status
    const statusObj = f['status'] as Record<string, unknown> | undefined;
    const jiraStatus: JiraStatusInfo | undefined = statusObj
      ? {
          id: String(statusObj['id'] ?? ''),
          name: String(statusObj['name'] ?? ''),
          categoryKey: getString(statusObj, 'statusCategory', 'key') ?? 'undefined',
        }
      : undefined;

    // Extract assignee
    const assigneeObj = f['assignee'] as Record<string, unknown> | null | undefined;
    const jiraAssignee = assigneeObj
      ? (getString(assigneeObj, 'displayName') ?? null)
      : null;

    // Determine which kind of issue_updated this is
    const changeLog = payload['changelog'] as Record<string, unknown> | undefined;
    const items: unknown[] = Array.isArray(changeLog?.['items'])
      ? (changeLog!['items'] as unknown[])
      : [];

    const hasStatusChange = items.some(
      (i) => typeof i === 'object' && (i as Record<string, unknown>)['field'] === 'status',
    );
    const hasAssigneeChange = items.some(
      (i) => typeof i === 'object' && (i as Record<string, unknown>)['field'] === 'assignee',
    );

    // If no changelog items, treat as status changed (e.g. from issue_created)
    const kind: JiraEventKind =
      hasStatusChange || (!hasAssigneeChange && !hasStatusChange)
        ? 'issue_status_changed'
        : 'issue_assignee_changed';

    return {
      ...base,
      kind,
      jiraStatus,
      jiraAssignee,
    };
  }

  return base;
}
