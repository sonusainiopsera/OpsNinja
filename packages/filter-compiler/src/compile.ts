/**
 * compileToPredicate — pure function, no I/O, no framework dependencies.
 *
 * Transforms a validated FilterAst into a parameterised SQL predicate:
 *   { sql: string, params: unknown[] }
 *
 * The sql string uses PostgreSQL positional placeholders ($1, $2, …).
 * ALL user-supplied values appear exclusively in params — never interpolated
 * into the sql string. This is the core security guarantee of this module.
 *
 * compile() is INFALLIBLE when given a valid AST (i.e., one returned by
 * validateFilterAst). If it detects an internal inconsistency it throws
 * CompilerInternalError (a programmer error, not a user error).
 */

import { CompilerInternalError } from './errors';
import {
  ARRAY_OPERATORS,
  NULL_CHECK_OPERATORS,
  RANGE_OPERATORS,
} from './operators';
import { FIELD_REGISTRY, isKnownField, type SqlType } from './field-registry';
import { resolveRelativeDate, isRelativeDateToken, type Clock, SystemClock } from './clock';
import { computeSignature } from './signature';
import { type FilterAst, type FilterNode, type GroupNode } from './ast';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CompiledPredicate {
  sql: string;
  params: unknown[];
}

export interface CompileOptions {
  clock?: Clock;
}

// ---------------------------------------------------------------------------
// LIKE wildcard escaping
// ---------------------------------------------------------------------------

/** Escape PostgreSQL LIKE wildcards in user-supplied text values. */
function escapeLike(value: string): string {
  // Escape backslash first, then % and _
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ---------------------------------------------------------------------------
// Param binding
// ---------------------------------------------------------------------------

function addParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

// ---------------------------------------------------------------------------
// Date value resolution
// ---------------------------------------------------------------------------

function resolveDateValue(value: unknown, clock: Clock): Date {
  if (typeof value !== 'string') {
    throw new Error(`Expected string for date value, got ${typeof value}`);
  }
  if (isRelativeDateToken(value)) {
    return resolveRelativeDate(value, clock);
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Condition compiler
// ---------------------------------------------------------------------------

function compileCondition(
  node: FilterNode & { type: 'condition' },
  params: unknown[],
  clock: Clock,
  astSignature: string,
): string {
  if (!isKnownField(node.field)) {
    throw new CompilerInternalError(
      `Unknown field "${node.field}" reached compile() — this should have been caught by validateFilterAst`,
      astSignature,
    );
  }

  const entry = FIELD_REGISTRY[node.field];

  if (!(entry.allowedOperators as readonly string[]).includes(node.operator)) {
    throw new CompilerInternalError(
      `Operator "${node.operator}" not allowed on field "${node.field}"`,
      astSignature,
    );
  }

  const op = node.operator;
  const col = entry.column;

  // ── Null checks ────────────────────────────────────────────────────────────
  if (NULL_CHECK_OPERATORS.has(op as 'is_null' | 'is_not_null')) {
    if (entry.existsTable) {
      const isNull = op === 'is_null';
      return isNull
        ? `NOT EXISTS (SELECT 1 FROM "${entry.existsTable}" WHERE "${entry.existsTable}"."${entry.existsJoinColumn!}" = "tickets"."id")`
        : `EXISTS (SELECT 1 FROM "${entry.existsTable}" WHERE "${entry.existsTable}"."${entry.existsJoinColumn!}" = "tickets"."id")`;
    }
    return op === 'is_null' ? `${col} IS NULL` : `${col} IS NOT NULL`;
  }

  // ── Array operators: in / not_in ───────────────────────────────────────────
  if (ARRAY_OPERATORS.has(op as 'in' | 'not_in')) {
    if (!Array.isArray(node.value) || node.value.length === 0) {
      throw new CompilerInternalError(
        `Array operator "${op}" on field "${node.field}" requires a non-empty array`,
        astSignature,
      );
    }

    if (entry.existsTable) {
      const resolvedValues = resolveValues(node.value, entry.sqlType, clock);
      const placeholders = resolvedValues.map((v) => addParam(params, v)).join(', ');
      const existsSql = `EXISTS (SELECT 1 FROM "${entry.existsTable}" WHERE "${entry.existsTable}"."${entry.existsJoinColumn!}" = "tickets"."id" AND "${entry.existsTable}"."${entry.existsValueColumn!}" IN (${placeholders}))`;
      return op === 'not_in' ? `NOT ${existsSql}` : existsSql;
    }

    const resolvedValues = resolveValues(node.value, entry.sqlType, clock);
    const placeholders = resolvedValues.map((v) => addParam(params, v)).join(', ');
    return op === 'in'
      ? `${col} IN (${placeholders})`
      : `${col} NOT IN (${placeholders})`;
  }

  // ── Range operator: between ────────────────────────────────────────────────
  if (RANGE_OPERATORS.has(op as 'between')) {
    if (!Array.isArray(node.value) || node.value.length !== 2) {
      throw new CompilerInternalError(
        `"between" on field "${node.field}" requires [lower, upper] array`,
        astSignature,
      );
    }
    const lower = resolveScalar(node.value[0], entry.sqlType, clock);
    const upper = resolveScalar(node.value[1], entry.sqlType, clock);
    const p1 = addParam(params, lower);
    const p2 = addParam(params, upper);
    return `${col} BETWEEN ${p1} AND ${p2}`;
  }

  // ── Text contains (ILIKE with wildcard escaping) ───────────────────────────
  if (op === 'contains') {
    if (typeof node.value !== 'string') {
      throw new CompilerInternalError(
        `"contains" on field "${node.field}" requires a string value`,
        astSignature,
      );
    }
    const escaped = escapeLike(node.value);
    const placeholder = addParam(params, `%${escaped}%`);
    return `${col} ILIKE ${placeholder}`;
  }

  // ── Scalar operators: eq, neq, gt, gte, lt, lte ───────────────────────────
  const resolved = resolveScalar(node.value, entry.sqlType, clock);
  const placeholder = addParam(params, resolved);

  switch (op) {
    case 'eq':  return `${col} = ${placeholder}`;
    case 'neq': return `${col} != ${placeholder}`;
    case 'gt':  return `${col} > ${placeholder}`;
    case 'gte': return `${col} >= ${placeholder}`;
    case 'lt':  return `${col} < ${placeholder}`;
    case 'lte': return `${col} <= ${placeholder}`;
    default:
      throw new CompilerInternalError(
        `Unhandled operator "${op}" for field "${node.field}"`,
        astSignature,
      );
  }
}

// ---------------------------------------------------------------------------
// Value resolution
// ---------------------------------------------------------------------------

function resolveScalar(value: unknown, sqlType: SqlType, clock: Clock): unknown {
  if (sqlType === 'timestamp') {
    return resolveDateValue(value, clock);
  }
  return value;
}

function resolveValues(values: unknown[], sqlType: SqlType, clock: Clock): unknown[] {
  return values.map((v) => resolveScalar(v, sqlType, clock));
}

// ---------------------------------------------------------------------------
// Group compiler
// ---------------------------------------------------------------------------

function compileGroup(
  node: GroupNode,
  params: unknown[],
  clock: Clock,
  astSignature: string,
): string {
  if (node.children.length === 0) {
    // Empty AND group → tautology; empty OR group → contradiction
    return node.op === 'and' ? 'TRUE' : 'FALSE';
  }

  const parts = node.children.map((child) =>
    compileNode(child, params, clock, astSignature),
  );
  const operator = node.op === 'and' ? ' AND ' : ' OR ';
  return `(${parts.join(operator)})`;
}

// ---------------------------------------------------------------------------
// Node dispatcher
// ---------------------------------------------------------------------------

function compileNode(
  node: FilterNode,
  params: unknown[],
  clock: Clock,
  astSignature: string,
): string {
  if (node.type === 'condition') {
    return compileCondition(node, params, clock, astSignature);
  }
  return compileGroup(node, params, clock, astSignature);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile a validated FilterAst to a parameterised SQL predicate.
 *
 * @param ast - Must be a validated AST (returned by validateFilterAst / parseFilterAst).
 * @param options - Optional CompileOptions (clock injection for tests).
 * @returns { sql: string, params: unknown[] } — sql contains only $n placeholders, never literals.
 * @throws CompilerInternalError on internal inconsistency (programmer error, not user input error).
 */
export function compileToPredicate(
  ast: FilterAst,
  options: CompileOptions = {},
): CompiledPredicate {
  const clock = options.clock ?? SystemClock;
  const signature = computeSignature(ast);
  const params: unknown[] = [];
  const sql = compileNode(ast, params, clock, signature);
  return { sql, params };
}
