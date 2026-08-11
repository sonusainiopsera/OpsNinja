/**
 * derive-changed-fields.ts – shallow and deep diff utility for audit records.
 *
 * Returns an array of dotted-path strings for every key whose value differs
 * between `before` and `after`, including nested JSONB custom-field maps:
 *
 *   { custom_fields: { cloud_provider: 'aws' } }
 *   { custom_fields: { cloud_provider: 'gcp' } }
 *   → ['custom_fields.cloud_provider']
 *
 * Rules:
 *   - Top-level key added in after  → included (key)
 *   - Top-level key removed in after → included (key)
 *   - Value changed                 → included (key)
 *   - Value unchanged               → excluded
 *   - Nested objects are flattened one level deep for readability; deeper
 *     nesting is reported at the first non-matching level.
 *   - Comparison uses JSON serialisation so Buffer/Date differences are
 *     surfaced without special-casing.
 */

type PlainObject = Record<string, unknown>;

export function deriveChangedFields(
  before: PlainObject | null | undefined,
  after: PlainObject | null | undefined,
): string[] {
  if (!before && !after) return [];
  if (!before) return Object.keys(after ?? {});
  if (!after) return Object.keys(before);

  const changed: string[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const bVal = before[key];
    const aVal = after[key];
    if (!deepEqual(bVal, aVal)) {
      // Flatten one level for plain-object values (e.g. custom_fields JSONB).
      if (isPlainObject(bVal) || isPlainObject(aVal)) {
        const nested = deriveChangedFields(
          (bVal ?? {}) as PlainObject,
          (aVal ?? {}) as PlainObject,
        );
        if (nested.length > 0) {
          changed.push(...nested.map((f) => `${key}.${f}`));
        } else {
          changed.push(key);
        }
      } else {
        changed.push(key);
      }
    }
  }

  return changed;
}

function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
