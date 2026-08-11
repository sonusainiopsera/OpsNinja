/**
 * CustomFieldValidator — pure functional core for custom-field validation.
 *
 * NO NestJS imports. NO Drizzle imports. Only stdlib + zod.
 *
 * This module is the single source of truth for:
 *   1. What constitutes a valid value for each data type.
 *   2. Allow-list semantics: unknown keys are always rejected.
 *   3. In-memory compiled-validator cache keyed by (tenantId, version).
 *
 * Data types:
 *   string       — typeof string, optional maxLength / regex constraints
 *   number       — typeof number (NOT string-coercion), optional min / max / integer
 *   boolean      — typeof boolean
 *   date         — ISO 8601 string, normalised to UTC on output
 *   single_select — string value from a fixed options allow-list
 *   multi_select  — string[] from options allow-list, deduplicated, optional maxItems
 *
 * Security guarantee: strict allow-list posture. Any key not backed by an
 * active definition is rejected with an error — it is never silently stored.
 * Archived definitions are excluded from active validation but remain readable
 * (they appear in read output flagged archived so UI can render legacy values).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DataType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'single_select'
  | 'multi_select';

/** Per-type constraint bag stored in the constraints JSONB column. */
export interface FieldConstraints {
  /** string: maximum character length. */
  maxLength?: number;
  /** string: value must fully match this regular expression. */
  regex?: string;
  /** number: inclusive lower bound. */
  min?: number;
  /** number: inclusive upper bound. */
  max?: number;
  /** number: value must be a whole number. */
  integer?: boolean;
  /** multi_select: maximum number of selected items (after deduplication). */
  maxItems?: number;
}

/** Minimal shape of a definition record consumed by the validator. */
export interface FieldDefinition {
  fieldKey: string;
  dataType: string;
  required: boolean;
  /** string[] for select types; null/undefined for others. */
  options?: unknown;
  constraints?: FieldConstraints | null;
  /** Non-null → definition is archived; excluded from write validation. */
  archivedAt?: Date | string | null;
}

export interface FieldValidationError {
  fieldKey: string;
  reason: string;
}

export interface ValidateResult {
  valid: boolean;
  errors: FieldValidationError[];
  /** Normalised values (only present when valid === true). */
  normalized?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// In-memory compiled-validator cache
//
// Key: "${tenantId}:${version}" where version is an integer incremented by
// CustomFieldDefsService on every definition mutation.
// ---------------------------------------------------------------------------

type ValidatorFn = (values: Record<string, unknown>) => ValidateResult;
const _cache = new Map<string, ValidatorFn>();

/** Invalidate all cached validators for a tenant (called after any def write). */
export function invalidateValidatorCache(tenantId: string): void {
  for (const k of _cache.keys()) {
    if (k.startsWith(`${tenantId}:`)) {
      _cache.delete(k);
    }
  }
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

/**
 * Build (or retrieve from cache) a validator function for the given definitions.
 *
 * @param defs      Full set of definitions for the tenant (active + archived).
 * @param cacheKey  Optional cache key, format "${tenantId}:${version}".
 *                  When omitted the validator is compiled on demand without caching.
 */
export function compileValidator(
  defs: FieldDefinition[],
  cacheKey?: string,
): ValidatorFn {
  if (cacheKey) {
    const hit = _cache.get(cacheKey);
    if (hit) return hit;
  }

  // Only active (non-archived) defs participate in write validation.
  const activeDefs = defs.filter((d) => !d.archivedAt);
  const activeKeySet = new Set(activeDefs.map((d) => d.fieldKey));

  const fn: ValidatorFn = (values) => {
    const errors: FieldValidationError[] = [];
    const normalized: Record<string, unknown> = {};

    // ── 1. Unknown key rejection ─────────────────────────────────────────────
    for (const key of Object.keys(values)) {
      if (!activeKeySet.has(key)) {
        errors.push({ fieldKey: key, reason: `Unknown custom field key "${key}"` });
      }
    }

    // ── 2. Per-definition validation ─────────────────────────────────────────
    for (const def of activeDefs) {
      const raw = values[def.fieldKey];
      const absent = raw === undefined || raw === null;

      if (absent) {
        if (def.required) {
          errors.push({ fieldKey: def.fieldKey, reason: 'Required field is missing' });
        }
        continue; // nothing to validate further if absent
      }

      const c = (def.constraints ?? {}) as FieldConstraints;

      switch (def.dataType as DataType) {
        // ── string ────────────────────────────────────────────────────────────
        case 'string': {
          if (typeof raw !== 'string') {
            errors.push({ fieldKey: def.fieldKey, reason: 'Expected a string value' });
            break;
          }
          if (c.maxLength !== undefined && raw.length > c.maxLength) {
            errors.push({
              fieldKey: def.fieldKey,
              reason: `Exceeds maximum length of ${c.maxLength} characters`,
            });
            break;
          }
          if (c.regex !== undefined) {
            let re: RegExp;
            try {
              re = new RegExp(c.regex);
            } catch {
              // Invalid regex in definition — treat as unconstrained (log in caller)
              re = /.*/;
            }
            if (!re.test(raw)) {
              errors.push({
                fieldKey: def.fieldKey,
                reason: `Value does not match the required pattern`,
              });
              break;
            }
          }
          normalized[def.fieldKey] = raw;
          break;
        }

        // ── number ────────────────────────────────────────────────────────────
        case 'number': {
          if (typeof raw !== 'number') {
            // Numeric strings are rejected under strict typing (per WO edge-case spec)
            errors.push({
              fieldKey: def.fieldKey,
              reason: 'Expected a numeric value (string coercion is not accepted)',
            });
            break;
          }
          if (!isFinite(raw)) {
            errors.push({ fieldKey: def.fieldKey, reason: 'Numeric value must be finite' });
            break;
          }
          if (c.integer === true && !Number.isInteger(raw)) {
            errors.push({ fieldKey: def.fieldKey, reason: 'Expected an integer value' });
            break;
          }
          if (c.min !== undefined && raw < c.min) {
            errors.push({
              fieldKey: def.fieldKey,
              reason: `Value ${raw} is below minimum ${c.min}`,
            });
            break;
          }
          if (c.max !== undefined && raw > c.max) {
            errors.push({
              fieldKey: def.fieldKey,
              reason: `Value ${raw} exceeds maximum ${c.max}`,
            });
            break;
          }
          normalized[def.fieldKey] = raw;
          break;
        }

        // ── boolean ───────────────────────────────────────────────────────────
        case 'boolean': {
          if (typeof raw !== 'boolean') {
            errors.push({ fieldKey: def.fieldKey, reason: 'Expected a boolean value' });
            break;
          }
          normalized[def.fieldKey] = raw;
          break;
        }

        // ── date ──────────────────────────────────────────────────────────────
        case 'date': {
          if (typeof raw !== 'string') {
            errors.push({
              fieldKey: def.fieldKey,
              reason: 'Expected an ISO 8601 date string',
            });
            break;
          }
          const ms = Date.parse(raw);
          if (isNaN(ms)) {
            errors.push({
              fieldKey: def.fieldKey,
              reason: 'Invalid date — expected ISO 8601 format (e.g. 2024-06-01T12:00:00Z)',
            });
            break;
          }
          // Timezone-normalise to UTC ISO string for consistent storage
          normalized[def.fieldKey] = new Date(ms).toISOString();
          break;
        }

        // ── single_select ─────────────────────────────────────────────────────
        case 'single_select': {
          const allowed = toStringArray(def.options);
          if (typeof raw !== 'string') {
            errors.push({
              fieldKey: def.fieldKey,
              reason: 'Expected a string value for single_select',
            });
            break;
          }
          if (!allowed.includes(raw)) {
            errors.push({
              fieldKey: def.fieldKey,
              reason: `Value "${raw}" is not in the allowed options: ${allowed.join(', ')}`,
            });
            break;
          }
          normalized[def.fieldKey] = raw;
          break;
        }

        // ── multi_select ──────────────────────────────────────────────────────
        case 'multi_select': {
          const allowed = toStringArray(def.options);
          if (!Array.isArray(raw)) {
            errors.push({
              fieldKey: def.fieldKey,
              reason: 'Expected an array of strings for multi_select',
            });
            break;
          }
          // Empty array is valid (distinct from null per spec)
          if (raw.length === 0) {
            normalized[def.fieldKey] = [];
            break;
          }
          const nonStrings = raw.filter((v) => typeof v !== 'string');
          if (nonStrings.length > 0) {
            errors.push({
              fieldKey: def.fieldKey,
              reason: 'All multi_select values must be strings',
            });
            break;
          }
          const outOfAllowList = (raw as string[]).filter((v) => !allowed.includes(v));
          if (outOfAllowList.length > 0) {
            errors.push({
              fieldKey: def.fieldKey,
              reason: `Values not in allowed options: ${outOfAllowList.join(', ')}`,
            });
            break;
          }
          // Deduplicate preserving first occurrence order
          const deduped = [...new Set(raw as string[])];
          if (c.maxItems !== undefined && deduped.length > c.maxItems) {
            errors.push({
              fieldKey: def.fieldKey,
              reason: `Exceeds maximum of ${c.maxItems} items`,
            });
            break;
          }
          normalized[def.fieldKey] = deduped;
          break;
        }

        default:
          errors.push({
            fieldKey: def.fieldKey,
            reason: `Unknown data type "${def.dataType}"`,
          });
      }
    }

    if (errors.length === 0) {
      return { valid: true, errors: [], normalized };
    }
    return { valid: false, errors };
  };

  if (cacheKey) {
    _cache.set(cacheKey, fn);
  }
  return fn;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}
