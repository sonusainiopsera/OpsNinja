/**
 * Exhaustive operator list. Every allowed operator must be listed here.
 * Adding a new operator requires updating this file + the field registry.
 */

export const OPERATORS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'is_null',
  'is_not_null',
  'contains',
] as const;

export type Operator = (typeof OPERATORS)[number];

export function isOperator(value: string): value is Operator {
  return (OPERATORS as readonly string[]).includes(value);
}

/** Operators that take no value argument. */
export const NULL_CHECK_OPERATORS: ReadonlySet<Operator> = new Set([
  'is_null',
  'is_not_null',
] as Operator[]);

/** Operators that take an array value. */
export const ARRAY_OPERATORS: ReadonlySet<Operator> = new Set([
  'in',
  'not_in',
] as Operator[]);

/** Operators that take a two-element array [lower, upper]. */
export const RANGE_OPERATORS: ReadonlySet<Operator> = new Set([
  'between',
] as Operator[]);

/** Operators valid on text/string fields for partial matching. */
export const TEXT_OPERATORS: ReadonlySet<Operator> = new Set([
  'contains',
] as Operator[]);

/** Operators valid on comparable types (timestamps, numbers). */
export const COMPARISON_OPERATORS: ReadonlySet<Operator> = new Set([
  'gt',
  'gte',
  'lt',
  'lte',
] as Operator[]);

/** Operators that take a scalar (non-array) value. */
export const SCALAR_OPERATORS: ReadonlySet<Operator> = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
] as Operator[]);
