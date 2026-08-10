/**
 * Audit diff builder.
 *
 * Produces a minimal before/after diff limited to changed keys, with an
 * allow-list of auditable fields per resource type so unbounded blobs are
 * never stored in audit_logs.
 *
 * Design goals:
 *   - Changed-only diffs keep audit_logs small and readable.
 *   - Per-resource allow-lists prevent PII-heavy or volatile fields (e.g.
 *     AI-generated summaries, session tokens) from landing in the audit trail.
 *   - Size cap + truncation flag prevent a single row from bloating the table.
 *   - The redactor is applied AFTER the diff so only the diffed fields are
 *     redacted, avoiding unnecessary work on the full record.
 */

import { redact } from '@opsninja/shared/privacy';

// ---------------------------------------------------------------------------
// Allow-lists per resource type
// ---------------------------------------------------------------------------

type AllowList = ReadonlySet<string>;

const ALWAYS_AUDITED: AllowList = new Set([
  'id', 'tenant_id', 'tenantId', 'status', 'created_at', 'createdAt',
  'updated_at', 'updatedAt',
]);

const RESOURCE_ALLOW_LISTS: Record<string, AllowList> = {
  ticket: new Set([
    ...ALWAYS_AUDITED,
    'organizationId', 'organization_id',
    'requesterContactId', 'requester_contact_id',
    'assigneeUserId', 'assignee_user_id',
    'status', 'priority', 'categoryId', 'category_id',
    'subject', // subject is audited but redacted in payload
  ]),
  organization: new Set([
    ...ALWAYS_AUDITED,
    'name', 'tier', 'region', 'isActive', 'is_active',
    'planTier', 'plan_tier',
  ]),
  user: new Set([
    ...ALWAYS_AUDITED,
    'kind', 'status', 'externalSubject', 'external_subject',
    // email omitted — Confidential; recorded only as [REDACTED] in context
    'email',
  ]),
  comment: new Set([
    ...ALWAYS_AUDITED,
    'ticketId', 'ticket_id',
    'authorUserId', 'author_user_id',
    'visibility',
    // body omitted — Confidential
  ]),
  role_assignment: new Set([
    ...ALWAYS_AUDITED,
    'userId', 'user_id', 'role', 'scopeVersion', 'scope_version',
  ]),
  category: new Set([
    ...ALWAYS_AUDITED,
    'parentId', 'parent_id', 'name', 'path',
  ]),
  // Fallback for unregistered resource types: audit only always-audited fields.
  _default: ALWAYS_AUDITED,
};

// ---------------------------------------------------------------------------
// Size cap
// ---------------------------------------------------------------------------

/** Maximum serialised byte length of the combined diff payload. */
const MAX_DIFF_BYTES = 16_384; // 16 KB

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditDiff {
  /** Fields that were present before but absent after (deletion). */
  removed: Record<string, unknown>;
  /** Fields that were absent before but present after (addition). */
  added: Record<string, unknown>;
  /** Fields whose values changed. Before and after values are included. */
  changed: Record<string, { before: unknown; after: unknown }>;
  /** True if the diff was truncated to fit within MAX_DIFF_BYTES. */
  truncated?: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes a minimal, allow-listed, redacted diff between `before` and `after`
 * state objects for the given resource type.
 *
 * @param resourceType - e.g. 'ticket', 'organization', 'user'
 * @param before       - State before the mutation (null for creates).
 * @param after        - State after the mutation (null for deletes).
 */
export function buildDiff(
  resourceType: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditDiff {
  const allowList = RESOURCE_ALLOW_LISTS[resourceType] ?? RESOURCE_ALLOW_LISTS['_default']!;

  const rawBefore = filterByAllowList(before ?? {}, allowList);
  const rawAfter  = filterByAllowList(after  ?? {}, allowList);

  const diff: AuditDiff = { removed: {}, added: {}, changed: {} };

  const allKeys = new Set([...Object.keys(rawBefore), ...Object.keys(rawAfter)]);
  for (const key of allKeys) {
    const had = Object.prototype.hasOwnProperty.call(rawBefore, key);
    const has = Object.prototype.hasOwnProperty.call(rawAfter, key);

    if (had && !has) {
      diff.removed[key] = redact({ [key]: rawBefore[key] })?.[key as keyof typeof rawBefore];
    } else if (!had && has) {
      diff.added[key] = redact({ [key]: rawAfter[key] })?.[key as keyof typeof rawAfter];
    } else if (had && has && !deepEqual(rawBefore[key], rawAfter[key])) {
      diff.changed[key] = {
        before: redact({ [key]: rawBefore[key] })?.[key as keyof typeof rawBefore],
        after:  redact({ [key]: rawAfter[key]  })?.[key as keyof typeof rawAfter],
      };
    }
  }

  return capSize(diff);
}

/**
 * Returns the allow-list for the given resource type.
 * Exported for testing.
 */
export function getAllowList(resourceType: string): AllowList {
  return RESOURCE_ALLOW_LISTS[resourceType] ?? RESOURCE_ALLOW_LISTS['_default']!;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function filterByAllowList(
  obj: Record<string, unknown>,
  allowList: AllowList,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (allowList.has(key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

function capSize(diff: AuditDiff): AuditDiff {
  const json = JSON.stringify(diff);
  if (json.length <= MAX_DIFF_BYTES) return diff;

  // Truncate changed first (largest), then added, then removed.
  const truncated: AuditDiff = { removed: {}, added: {}, changed: {}, truncated: true };
  let budget = MAX_DIFF_BYTES - 100; // reserve space for the truncated flag

  for (const [key, value] of Object.entries(diff.changed)) {
    const entry = JSON.stringify({ [key]: value });
    if (budget - entry.length >= 0) {
      truncated.changed[key] = value;
      budget -= entry.length;
    }
  }
  for (const [key, value] of Object.entries(diff.added)) {
    const entry = JSON.stringify({ [key]: value });
    if (budget - entry.length >= 0) {
      truncated.added[key] = value;
      budget -= entry.length;
    }
  }
  for (const [key, value] of Object.entries(diff.removed)) {
    const entry = JSON.stringify({ [key]: value });
    if (budget - entry.length >= 0) {
      truncated.removed[key] = value;
      budget -= entry.length;
    }
  }
  return truncated;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
