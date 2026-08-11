/**
 * org-audit-diff — WO-030.
 *
 * Pure utility for building field-level diff entries from audit log rows in the
 * organization domain.  Two responsibilities:
 *
 * 1. PII field classification: fields classified Confidential (contact email,
 *    phone, name) are masked in the diff response while still reporting that the
 *    field changed (redacted: true).
 *
 * 2. Diff entry construction: converts the stored (changedFields, beforeState,
 *    afterState) triple from an audit_logs row into the { field, before, after,
 *    redacted } shape required by the audit read API.
 *
 * SECURITY: This module never un-masks stored values — it masks on the read
 * path so callers cannot accidentally log or return PII.  Redaction on the
 * write path is handled by the AuditWriter / DefaultRedactor pipeline.
 */

// ---------------------------------------------------------------------------
// PII field classification
// ---------------------------------------------------------------------------

/**
 * Top-level field names whose values are Confidential in the organization
 * domain.  Contact email, phone, and name variants are masked in all
 * diff response payloads regardless of nesting depth.
 */
export const ORG_PII_FIELDS: ReadonlySet<string> = new Set([
  // Contact identity
  'email',
  'phone',
  'phoneNumber',
  'phone_number',
  'name',
  'firstName',
  'lastName',
  'first_name',
  'last_name',
  'displayName',
  'display_name',
  // Catch aliases that sometimes appear in custom metadata
  'contact_email',
  'contactEmail',
  'contact_name',
  'contactName',
]);

export const REDACTED_MARKER = '[redacted]';

// ---------------------------------------------------------------------------
// Diff entry shape
// ---------------------------------------------------------------------------

export interface DiffEntry {
  /** Dotted-path field name (e.g. 'name', 'customFieldValues.cloud_provider'). */
  field: string;
  /** Value before the mutation, or null for create events. */
  before: unknown;
  /** Value after the mutation, or null for delete / deactivation events. */
  after: unknown;
  /**
   * True when the field is classified Confidential and the before/after values
   * have been replaced with the redacted marker.  Callers can use this flag to
   * render a "changed (hidden)" indicator in the UI rather than no indicator.
   */
  redacted: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a diff entry array suitable for the audit read API response.
 *
 * @param changedFields - Array of dotted-path field names that changed.
 *   Comes from the `changed_fields` column (computed pre-redaction by
 *   AuditWriter so PII fields are correctly represented here).
 * @param beforeState   - Full pre-mutation snapshot (may contain already
 *   redacted values for email/phone written by DefaultRedactor).
 * @param afterState    - Full post-mutation snapshot.
 * @param piiFields     - Override the default PII field set (useful in tests).
 * @returns Array of { field, before, after, redacted } entries, one per
 *   changed field.  Returns empty array when changedFields is null or empty.
 */
export function buildDiffEntries(
  changedFields: string[] | null | undefined,
  beforeState: unknown,
  afterState: unknown,
  piiFields: ReadonlySet<string> = ORG_PII_FIELDS,
): DiffEntry[] {
  if (!changedFields || changedFields.length === 0) return [];

  const before = isRecord(beforeState) ? beforeState : {};
  const after  = isRecord(afterState)  ? afterState  : {};

  return changedFields.map((field) => {
    const topKey = field.split('.')[0] ?? field;
    const isPii  = piiFields.has(topKey);

    return {
      field,
      before:   isPii ? REDACTED_MARKER : getNestedValue(before, field),
      after:    isPii ? REDACTED_MARKER : getNestedValue(after,  field),
      redacted: isPii,
    };
  });
}

/**
 * Mask all PII fields in a snapshot object in-place (returns new object).
 *
 * Used when building the beforeState / afterState snapshots for an
 * org-domain audit record so PII values never flow into the audit table even
 * if DefaultRedactor misses a variant.
 */
export function maskOrgPiiSnapshot(
  snapshot: Record<string, unknown>,
  piiFields: ReadonlySet<string> = ORG_PII_FIELDS,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    result[key] = piiFields.has(key) ? REDACTED_MARKER : value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Traverse a dotted path and return the leaf value (or undefined).
 * Supports one level of nesting for JSONB columns (e.g. customFieldValues.x).
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}
