/**
 * Allowed operators for the filter compiler.
 *
 * Only these operator strings may appear in a condition node.
 * Any string outside this set is rejected at validation time.
 */
export const OPERATORS = [
  'eq',         // field = $1
  'neq',        // field != $1
  'in',         // field = ANY($1)  (non-empty array required)
  'not_in',     // field != ALL($1) (non-empty array required)
  'gt',         // field > $1
  'gte',        // field >= $1
  'lt',         // field < $1
  'lte',        // field <= $1
  'between',    // field BETWEEN $1 AND $2  (2-element array)
  'is_null',    // field IS NULL
  'is_not_null', // field IS NOT NULL
  'contains',   // field ILIKE $1  (LIKE wildcards escaped)
] as const;

export type Operator = (typeof OPERATORS)[number];

export const OPERATOR_SET = new Set<string>(OPERATORS);

export function isOperator(s: string): s is Operator {
  return OPERATOR_SET.has(s);
}

/** Operators that do not take a value argument. */
export const NULL_OPS = new Set<Operator>(['is_null', 'is_not_null']);

/** Operators that require the value to be an array. */
export const ARRAY_OPS = new Set<Operator>(['in', 'not_in', 'between']);

/** Operators only valid on text fields. */
export const TEXT_OPS = new Set<Operator>(['contains']);

/** Comparison operators valid only on orderable types (date, uuid comparisons). */
export const COMPARISON_OPS = new Set<Operator>(['gt', 'gte', 'lt', 'lte', 'between']);
