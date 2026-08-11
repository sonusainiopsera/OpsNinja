/**
 * deriveChangedFields — diffs two object snapshots and returns the dotted paths
 * of keys whose values changed.
 *
 * JSONB maps (e.g. custom_fields) are flattened recursively:
 *   { custom_fields: { cloud_provider: 'aws' } } → 'custom_fields.cloud_provider'
 *
 * Rules:
 *  - Returns null when the two snapshots are deeply equal (no-op PATCH; no
 *    audit record should be emitted for idempotent changes).
 *  - Ignores timestamp-only changes (updatedAt, updated_at) — these are not
 *    meaningful business changes.
 *  - Handles null/undefined before/after states gracefully.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare before and after state snapshots and return the list of dotted-path
 * field names that changed.
 *
 * Returns null when there are no changes (signals: emit no audit record).
 */
export function deriveChangedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] | null {
  const changed: string[] = [];

  if (before == null && after == null) return null;
  if (before == null && after != null) {
    // Entire object created — return all leaf paths
    collectPaths(after, '', changed);
    return changed.length > 0 ? changed : null;
  }
  if (before != null && after == null) {
    // Entire object deleted — return all leaf paths
    collectPaths(before, '', changed);
    return changed.length > 0 ? changed : null;
  }

  diffObjects(before!, after!, '', changed);
  return changed.length > 0 ? changed : null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const IGNORED_KEYS = new Set(['updatedAt', 'updated_at', 'createdAt', 'created_at']);

function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  prefix: string,
  changed: string[],
): void {
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    if (IGNORED_KEYS.has(key)) continue;

    const path = prefix ? `${prefix}.${key}` : key;
    const bVal = before[key];
    const aVal = after[key];

    if (isPlainObject(bVal) && isPlainObject(aVal)) {
      diffObjects(
        bVal as Record<string, unknown>,
        aVal as Record<string, unknown>,
        path,
        changed,
      );
    } else if (!deepEqual(bVal, aVal)) {
      changed.push(path);
    }
  }
}

function collectPaths(
  obj: Record<string, unknown>,
  prefix: string,
  paths: string[],
): void {
  for (const [key, val] of Object.entries(obj)) {
    if (IGNORED_KEYS.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(val)) {
      collectPaths(val as Record<string, unknown>, path, paths);
    } else {
      paths.push(path);
    }
  }
}

function isPlainObject(v: unknown): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, idx) => deepEqual(item, (b as unknown[])[idx]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a as object).sort();
    const bKeys = Object.keys(b as object).sort();
    if (aKeys.length !== bKeys.length) return false;
    if (aKeys.join(',') !== bKeys.join(',')) return false;
    return aKeys.every((k) =>
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    );
  }

  return false;
}
