/**
 * Cursor encoding / decoding for keyset pagination — WO-040.
 *
 * A cursor encodes the sort tuple of the last row returned plus the ticket id
 * as a stable tiebreaker. This guarantees pages are stable under concurrent
 * inserts and never skip or duplicate rows.
 *
 * Encoding: base64url(JSON.stringify({ values: [{field, value},...], id: uuid }))
 * Validation: decoded cursor fields must match the active sort spec.
 * A mismatch (e.g. the client changed the sort order) returns 400.
 */

import { BadRequestException } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SortField {
  field: string;
  direction: 'asc' | 'desc';
}

export interface CursorPayload {
  /** Sort values corresponding to the last row's sort columns, in order. */
  values: Array<{ field: string; value: unknown }>;
  /** Ticket id of the last row — stable tiebreaker. */
  id: string;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a cursor from the last row's sort values plus its ticket id.
 *
 * @param sortSpec  Active sort specification (field + direction order matters).
 * @param lastRow   Object containing the sort field values + id.
 */
export function encodeCursor(
  sortSpec: SortField[],
  lastRow: Record<string, unknown> & { id: string },
): string {
  const payload: CursorPayload = {
    values: sortSpec.map((s) => ({ field: s.field, value: lastRow[s.field] ?? null })),
    id: lastRow['id'],
  };
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

// ---------------------------------------------------------------------------
// Decode + validate
// ---------------------------------------------------------------------------

/**
 * Decode and validate a cursor string.
 *
 * @throws BadRequestException when the cursor is malformed or its sort fields
 *   do not match `activeSortSpec` (cursor + sort spec mismatch).
 */
export function decodeCursor(
  encoded: string,
  activeSortSpec: SortField[],
): CursorPayload {
  let payload: CursorPayload;
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    payload = JSON.parse(json) as CursorPayload;
  } catch {
    throw new BadRequestException({
      error: { code: 'CURSOR_INVALID', message: 'The pagination cursor is malformed.' },
    });
  }

  // Structural validation
  if (
    !payload ||
    !Array.isArray(payload.values) ||
    typeof payload.id !== 'string'
  ) {
    throw new BadRequestException({
      error: { code: 'CURSOR_INVALID', message: 'The pagination cursor is malformed.' },
    });
  }

  // Sort-spec validation: decoded fields must match activeSortSpec exactly
  const cursorFields = payload.values.map((v) => v.field);
  const specFields = activeSortSpec.map((s) => s.field);

  const mismatch =
    cursorFields.length !== specFields.length ||
    cursorFields.some((f, i) => f !== specFields[i]);

  if (mismatch) {
    throw new BadRequestException({
      error: {
        code: 'CURSOR_SORT_MISMATCH',
        message:
          'The cursor was issued for a different sort order. ' +
          'Omit the cursor to start from the first page with the new sort.',
      },
    });
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Build keyset WHERE predicate SQL fragment
// ---------------------------------------------------------------------------

/**
 * Builds the keyset pagination SQL condition given a decoded cursor and the
 * active sort spec.
 *
 * For a sort spec [{ field: 'updated_at', direction: 'desc' }, ...] and tiebreaker id,
 * the condition is:
 *
 *   (updated_at < $n)
 *   OR (updated_at = $n AND id > $m)
 *
 * For multiple sort keys, the condition expands recursively.
 * NULL-safe: nullable sort columns use IS NULL checks.
 *
 * Returns { sql: string, params: unknown[] } with $N placeholders matching
 * the filter-compiler convention. The caller is responsible for adjusting
 * offsets when composing with other predicates.
 */
export function buildCursorPredicate(
  sortSpec: SortField[],
  cursor: CursorPayload,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];

  function param(v: unknown): string {
    params.push(v);
    return `$${params.length}`;
  }

  /**
   * Build the comparison for one sort level.
   * remainingFields: fields at this level and below.
   * remainingValues: corresponding cursor values.
   */
  function buildLevel(
    fields: SortField[],
    values: Array<{ field: string; value: unknown }>,
    idValue: string,
  ): string {
    const f = fields[0];
    if (!f) return 'false';

    const v = values[0]!.value;
    const colSql = fieldToColumn(f.field);
    // For DESC direction: next page has smaller value (or equal and id >)
    // For ASC direction: next page has larger value (or equal and id >)
    const strictOp = f.direction === 'desc' ? '<' : '>';

    // Base comparisons for this level
    let strictCmp: string;
    let equalCmp: string;

    if (v === null || v === undefined) {
      // NULL handling: NULLs LAST means null values sort after non-null
      // For DESC NULLS LAST: non-null < NULL, so strict: IS NOT NULL (when cursor is null, everything strictly comes before)
      // For ASC NULLS LAST: non-null < NULL, so when cursor is null no rows are strictly before
      if (f.direction === 'desc') {
        // cursor is NULL means it's at the end; nothing comes strictly "after" a NULL in desc
        strictCmp = 'false';
      } else {
        // cursor is NULL means it's at the end (ASC NULLS LAST); nothing after it either
        strictCmp = 'false';
      }
      equalCmp = `${colSql} IS NULL`;
    } else {
      strictCmp = `(${colSql} IS NOT NULL AND ${colSql} ${strictOp} ${param(v)})`;
      equalCmp = `${colSql} = ${param(v)}`;
    }

    if (fields.length === 1) {
      // Last sort field: tiebreak on id (always ascending)
      const idParam = param(idValue);
      return `(${strictCmp} OR (${equalCmp} AND t.id > ${idParam}))`;
    }

    const innerLevel = buildLevel(fields.slice(1), values.slice(1), idValue);
    return `(${strictCmp} OR (${equalCmp} AND ${innerLevel}))`;
  }

  const sql = buildLevel(sortSpec, cursor.values, cursor.id);
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Field to column mapping
// ---------------------------------------------------------------------------

/** Maps allowed sort field names to their SQL column expressions. */
export function fieldToColumn(field: string): string {
  const MAP: Record<string, string> = {
    created_at:  't.created_at',
    updated_at:  't.updated_at',
    resolved_at: 't.resolved_at',
    priority:    't.priority',
    status:      't.status',
    sla_state:   'NULL',  // placeholder until SLA timer WO
  };
  return MAP[field] ?? `t.${field}`;
}

/** Builds ORDER BY clause from sort spec (always appends id as tiebreaker). */
export function buildOrderByClause(sortSpec: SortField[]): string {
  const parts = sortSpec.map(({ field, direction }) => {
    const col = fieldToColumn(field);
    const dir = direction.toUpperCase();
    const nulls = direction === 'asc' ? 'NULLS LAST' : 'NULLS LAST';
    return `${col} ${dir} ${nulls}`;
  });
  // Always include id as final tiebreaker
  parts.push('t.id ASC');
  return parts.join(', ');
}
