/**
 * jql-builder.ts — pure JQL construction for reconciliation Jira search (WO-057).
 *
 * No I/O, no framework imports. Returns JQL strings that can be tested
 * exhaustively without mocking.
 *
 * Produced JQL targets the minimal field set needed for drift detection:
 *   project in (KEYS) AND updated >= -{lookback} ORDER BY updated ASC
 *
 * Constraints:
 *   - Empty project list → returns null (caller must skip the run immediately).
 *   - Project keys are validated: only alphanumeric + hyphen, 1–50 chars.
 *   - Lookback is clamped to [1, RECON_LOOKBACK_MAX_HOURS * 60] minutes.
 *   - JQL uses -Nm notation to avoid sending server timestamps (which differ
 *     from what Jira expects and avoids clock-skew edge cases).
 */

import {
  RECON_LOOKBACK_MAX_HOURS,
  RECON_PAGE_SIZE,
} from '@opsninja/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JqlBuildInput {
  /** Enabled project keys from jira_project_mappings. */
  projectKeys: string[];
  /** How far back to search, in hours. Clamped to [1, RECON_LOOKBACK_MAX_HOURS]. */
  lookbackHours: number;
}

export interface JqlBuildResult {
  /** The JQL string to use in the Jira search call, or null if no enabled keys. */
  jql: string | null;
  /** Fields to request. Always the same minimal set. */
  fields: string[];
  /** Max results per page. */
  maxResults: number;
}

// ---------------------------------------------------------------------------
// Allowed project key pattern: uppercase letter start, alphanum + hyphen, 1-50 chars
// ---------------------------------------------------------------------------

const PROJECT_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,49}$/;

function sanitizeKey(key: string): string | null {
  if (PROJECT_KEY_RE.test(key)) return key.toUpperCase();
  return null;
}

// ---------------------------------------------------------------------------
// Core export
// ---------------------------------------------------------------------------

/**
 * Build a JQL search payload for the reconciliation job.
 *
 * @returns JqlBuildResult — jql is null when there are no valid project keys.
 */
export function buildReconciliationJql(input: JqlBuildInput): JqlBuildResult {
  const fields = ['status', 'assignee', 'updated', 'resolution', 'summary'];

  const validKeys = input.projectKeys
    .map(sanitizeKey)
    .filter((k): k is string => k !== null);

  if (validKeys.length === 0) {
    return { jql: null, fields, maxResults: RECON_PAGE_SIZE };
  }

  // Clamp lookback to valid range
  const clampedHours = Math.max(
    1,
    Math.min(input.lookbackHours, RECON_LOOKBACK_MAX_HOURS),
  );
  const lookbackMinutes = clampedHours * 60;

  // project in (KEY1, KEY2) AND updated >= -{minutes}m ORDER BY updated ASC
  const projectList = validKeys.map((k) => `"${k}"`).join(', ');
  const jql = `project in (${projectList}) AND updated >= -${lookbackMinutes}m ORDER BY updated ASC`;

  return { jql, fields, maxResults: RECON_PAGE_SIZE };
}

/**
 * Build a JQL search to locate an issue by OpsNinja idempotency marker property.
 * Used in the pending-link repair path.
 */
export function buildIdempotencyMarkerJql(
  projectKey: string,
  idempotencyValue: string,
): string | null {
  const sanitized = sanitizeKey(projectKey);
  if (!sanitized) return null;

  // The outbound create path writes a custom property or label; search for it.
  // Fallback: by summary prefix if no property exists.
  const escaped = idempotencyValue.replace(/"/g, '\\"');
  return `project = "${sanitized}" AND labels = "opsninja:${escaped}"`;
}
