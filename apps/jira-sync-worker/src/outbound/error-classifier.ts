/**
 * error-classifier.ts — classify Jira HTTP errors as transient or permanent.
 *
 * Pure functions — no I/O, no framework dependencies.
 *
 * Transient errors trigger retry: the item is put back with a visibility
 * timeout extension so the worker does not block.
 *
 * Permanent errors terminate retries immediately: the link is marked failed
 * with a stable error_code and no further attempts are made.
 *
 * Error codes are stable strings that appear in ticket_jira_links.error_code
 * and jira_sync_dlq.last_error_code.  They must not change across deploys
 * because operators filter the DLQ by them.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JiraErrorKind = 'transient' | 'permanent';

export interface JiraErrorClassification {
  kind: JiraErrorKind;
  /** Stable error code for the DB and metrics. */
  code: JiraErrorCode;
  /** Human-readable message suitable for the operator console. */
  message: string;
  /**
   * Seconds to wait before the next attempt.
   * Only meaningful for transient errors; 0 for permanent.
   * Populated from Retry-After header when present.
   */
  retryAfterSeconds?: number;
}

export type JiraErrorCode =
  | 'JIRA_TIMEOUT'
  | 'JIRA_UNREACHABLE'
  | 'JIRA_RATE_LIMITED'
  | 'JIRA_SERVER_ERROR'
  | 'JIRA_VALIDATION_ERROR'
  | 'JIRA_UNAUTHORIZED'
  | 'JIRA_FORBIDDEN'
  | 'JIRA_NOT_FOUND'
  | 'JIRA_GONE'
  | 'JIRA_TOKEN_REFRESH_FAILED'
  | 'JIRA_WORKFLOW_TRANSITION_INVALID'
  | 'JIRA_UNKNOWN';

// ---------------------------------------------------------------------------
// HTTP status → classification table
// ---------------------------------------------------------------------------

interface StatusRule {
  kind: JiraErrorKind;
  code: JiraErrorCode;
  message: string;
}

const STATUS_TABLE: ReadonlyMap<number, StatusRule> = new Map([
  // Transient
  [408, { kind: 'transient', code: 'JIRA_TIMEOUT',       message: 'Request timeout from Jira.' }],
  [429, { kind: 'transient', code: 'JIRA_RATE_LIMITED',  message: 'Jira rate limit exceeded.' }],
  [500, { kind: 'transient', code: 'JIRA_SERVER_ERROR',  message: 'Jira internal server error.' }],
  [502, { kind: 'transient', code: 'JIRA_SERVER_ERROR',  message: 'Bad gateway from Jira.' }],
  [503, { kind: 'transient', code: 'JIRA_SERVER_ERROR',  message: 'Jira service unavailable.' }],
  [504, { kind: 'transient', code: 'JIRA_SERVER_ERROR',  message: 'Gateway timeout from Jira.' }],
  // Permanent
  [400, { kind: 'permanent', code: 'JIRA_VALIDATION_ERROR', message: 'Jira rejected the request as invalid.' }],
  [401, { kind: 'permanent', code: 'JIRA_UNAUTHORIZED',     message: 'Jira credentials are invalid or expired.' }],
  [403, { kind: 'permanent', code: 'JIRA_FORBIDDEN',        message: 'Jira permission denied. Re-consent may be required.' }],
  [404, { kind: 'permanent', code: 'JIRA_NOT_FOUND',        message: 'Jira resource not found (project or issue deleted?).' }],
  [410, { kind: 'permanent', code: 'JIRA_GONE',             message: 'Jira resource permanently gone.' }],
  [422, { kind: 'permanent', code: 'JIRA_VALIDATION_ERROR', message: 'Jira unprocessable entity.' }],
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse Retry-After header value to seconds. Handles both numeric and HTTP-date forms. */
export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const numeric = parseInt(header, 10);
  if (!isNaN(numeric) && numeric >= 0) return numeric;
  // HTTP-date form
  const date = new Date(header);
  const diff = Math.ceil((date.getTime() - Date.now()) / 1000);
  return diff > 0 ? diff : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a Jira API error into transient or permanent.
 *
 * @param httpStatus         HTTP status code from the Jira response.
 * @param retryAfterHeader   Value of the Retry-After response header, if present.
 * @param errorBody          Parsed Jira error body (may be null for network errors).
 */
export function classifyJiraError(
  httpStatus: number | null,
  retryAfterHeader?: string | null,
  errorBody?: Record<string, unknown> | null,
): JiraErrorClassification {
  // Network / timeout (no HTTP status)
  if (httpStatus === null) {
    return {
      kind: 'transient',
      code: 'JIRA_UNREACHABLE',
      message: 'Could not connect to Jira (network error or DNS failure).',
    };
  }

  const rule = STATUS_TABLE.get(httpStatus);

  if (rule) {
    const retryAfterSeconds = httpStatus === 429
      ? parseRetryAfter(retryAfterHeader)
      : undefined;

    // Detect workflow transition validation errors (status 400 with specific message)
    if (httpStatus === 400 && isWorkflowTransitionError(errorBody)) {
      return {
        kind: 'permanent',
        code: 'JIRA_WORKFLOW_TRANSITION_INVALID',
        message: 'Jira workflow transition is not available for this issue.',
      };
    }

    return { ...rule, retryAfterSeconds };
  }

  // Default: treat 5xx as transient, everything else as permanent
  if (httpStatus >= 500) {
    return { kind: 'transient', code: 'JIRA_SERVER_ERROR', message: `Jira server error HTTP ${httpStatus}.` };
  }

  return { kind: 'permanent', code: 'JIRA_UNKNOWN', message: `Unexpected Jira HTTP status ${httpStatus}.` };
}

/**
 * Classify a caught exception (e.g. fetch network error, AbortError).
 */
export function classifyException(err: unknown): JiraErrorClassification {
  const name = (err as Error)?.name ?? '';
  const message = (err as Error)?.message ?? String(err);

  if (name === 'AbortError' || message.includes('timeout')) {
    return { kind: 'transient', code: 'JIRA_TIMEOUT', message: 'Jira request timed out.' };
  }

  return { kind: 'transient', code: 'JIRA_UNREACHABLE', message: 'Network error reaching Jira.' };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isWorkflowTransitionError(body: Record<string, unknown> | null | undefined): boolean {
  if (!body) return false;
  const errors = body['errors'] ?? body['errorMessages'];
  if (!errors) return false;
  const str = JSON.stringify(errors).toLowerCase();
  return str.includes('transition') || str.includes('workflow');
}
