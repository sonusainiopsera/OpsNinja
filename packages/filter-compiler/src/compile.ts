import { z } from 'zod';
import {
  FilterAstSchema,
  type FilterAst,
  type AstNode,
  type ConditionNode,
  type GroupNode,
  type AstValidationError,
  type ValidationResult,
  type ParseResult,
  AstErrorCode,
  countConditions,
  getDepth,
  MAX_DEPTH,
  MAX_CONDITIONS,
} from './ast';
import { isOperator, NULL_OPS, ARRAY_OPS, TEXT_OPS } from './operators';
import { getFieldDef, isKnownField } from './field-registry';
import {
  type Clock,
  systemClock,
  isRelativeDateToken,
  resolveRelativeToken,
  type RelativeDateToken,
} from './clock';

// ── Public types ──────────────────────────────────────────────────────────────

export interface Predicate {
  /** Parameterized SQL fragment, e.g. "(tickets.status = $1 AND tickets.priority = ANY($2))" */
  sql: string;
  /** Positional parameter values aligned to $1..$N in sql */
  params: unknown[];
}

// ── Parse ─────────────────────────────────────────────────────────────────────

/**
 * Parses a raw value into a structurally valid FilterAst.
 * Field names, operators and values are NOT semantically validated here.
 */
export function parseFilterAst(raw: unknown): ParseResult {
  const result = FilterAstSchema.safeParse(raw);
  if (!result.success) {
    const errors: AstValidationError[] = result.error.errors.map(e => ({
      path: e.path.map(String),
      code: AstErrorCode.PARSE_ERROR,
      message: e.message,
    }));
    return { ok: false, errors };
  }
  return { ok: true, ast: result.data };
}

// ── Validate ──────────────────────────────────────────────────────────────────

interface ValidateOptions {
  maxDepth?: number;
  maxConditions?: number;
}

/**
 * Semantically validates a structurally-correct FilterAst against the field
 * registry: checks depth, node count, field allow-list, operator allow-list
 * and value schemas. Returns a typed result so the API can produce 400 with
 * field-level details.
 */
export function validateFilterAst(
  ast: FilterAst,
  options: ValidateOptions = {},
): ValidationResult {
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const maxConds = options.maxConditions ?? MAX_CONDITIONS;

  const errors: AstValidationError[] = [];

  // Depth check
  const depth = getDepth(ast);
  if (depth > maxDepth) {
    errors.push({
      path: [],
      code: AstErrorCode.DEPTH_EXCEEDED,
      message: `Filter AST exceeds maximum nesting depth of ${maxDepth} (actual: ${depth})`,
    });
  }

  // Condition count check
  const condCount = countConditions(ast);
  if (condCount > maxConds) {
    errors.push({
      path: [],
      code: AstErrorCode.CONDITION_LIMIT_EXCEEDED,
      message: `Filter AST exceeds maximum of ${maxConds} condition nodes (actual: ${condCount})`,
    });
  }

  // Semantic validation per node
  function walkNode(node: AstNode, path: string[]): void {
    if (node.type === 'group') {
      node.children.forEach((child, i) => walkNode(child, [...path, 'children', String(i)]));
      return;
    }

    validateCondition(node, path, errors);
  }

  walkNode(ast, []);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, ast };
}

function validateCondition(
  node: ConditionNode,
  path: string[],
  errors: AstValidationError[],
): void {
  const { field, operator, value } = node;

  // Unknown field
  if (!isKnownField(field)) {
    errors.push({
      path: [...path, 'field'],
      code: AstErrorCode.UNKNOWN_FIELD,
      message: `Unknown field "${field}". Only allow-listed fields may be used.`,
    });
    return; // no further checks without a field def
  }

  // Unknown operator
  if (!isOperator(operator)) {
    errors.push({
      path: [...path, 'operator'],
      code: AstErrorCode.OPERATOR_NOT_ALLOWED,
      message: `Unknown operator "${operator}".`,
    });
    return;
  }

  const fieldDef = getFieldDef(field)!;

  // Operator not allowed for this field
  if (!(fieldDef.allowedOps as readonly string[]).includes(operator)) {
    errors.push({
      path: [...path, 'operator'],
      code: AstErrorCode.OPERATOR_NOT_ALLOWED,
      message: `Operator "${operator}" is not allowed for field "${field}". Allowed: ${fieldDef.allowedOps.join(', ')}.`,
    });
    return;
  }

  // Null operators don't need a value
  if (NULL_OPS.has(operator as 'is_null' | 'is_not_null')) return;

  // in / not_in: value must be non-empty array
  if (operator === 'in' || operator === 'not_in') {
    if (!Array.isArray(value) || value.length === 0) {
      errors.push({
        path: [...path, 'value'],
        code: AstErrorCode.EMPTY_IN_ARRAY,
        message: `Operator "${operator}" requires a non-empty array value for field "${field}".`,
      });
      return;
    }
  }

  // between: value must be a 2-element array or relative token
  if (operator === 'between') {
    if (!isRelativeDateToken(value) && (!Array.isArray(value) || value.length !== 2)) {
      errors.push({
        path: [...path, 'value'],
        code: AstErrorCode.INVALID_VALUE,
        message: `Operator "between" requires a [start, end] tuple or a relative date token for field "${field}".`,
      });
      return;
    }
  }

  // Value schema validation
  const result = fieldDef.valueSchema.safeParse(value);
  if (!result.success) {
    errors.push({
      path: [...path, 'value'],
      code: AstErrorCode.INVALID_VALUE,
      message: `Invalid value for field "${field}": ${result.error.errors[0]?.message ?? 'validation failed'}.`,
    });
  }
}

// ── Compile ───────────────────────────────────────────────────────────────────

export interface CompileOptions {
  clock?: Clock;
  /** Starting parameter index (defaults to 1) */
  paramOffset?: number;
}

/**
 * Compiles a validated FilterAst to a parameterized SQL predicate.
 *
 * The input MUST have passed validateFilterAst() with ok=true.
 * Any internal inconsistency throws a programmer-error with the AST signature.
 * User-supplied literals NEVER appear in the generated SQL string — they are
 * always in the params array bound by the driver.
 */
export function compileToPredicate(ast: FilterAst, options: CompileOptions = {}): Predicate {
  const clock = options.clock ?? systemClock;
  const params: unknown[] = [];

  function push(value: unknown): string {
    params.push(value);
    return `$${params.length}`;
  }

  function compileNode(node: AstNode): string {
    if (node.type === 'group') return compileGroup(node);
    return compileCondition(node);
  }

  function compileGroup(node: GroupNode): string {
    if (node.children.length === 0) {
      // Empty group compiles to a tautology (TRUE) to produce valid SQL
      return 'TRUE';
    }
    const parts = node.children.map(compileNode);
    const op = node.op === 'and' ? ' AND ' : ' OR ';
    return parts.length === 1 ? parts[0]! : `(${parts.join(op)})`;
  }

  function compileCondition(node: ConditionNode): string {
    const { field, operator, value } = node;
    const fieldDef = getFieldDef(field);

    if (!fieldDef) {
      // Should never happen post-validation
      throw Object.assign(
        new Error(`[filter-compiler] PROGRAMMER_ERROR: unknown field "${field}" passed to compile`),
        { code: AstErrorCode.PROGRAMMER_ERROR, field },
      );
    }

    // Null operators
    if (operator === 'is_null') return `${fieldDef.columnExpr} IS NULL`;
    if (operator === 'is_not_null') return `${fieldDef.columnExpr} IS NOT NULL`;

    // EXISTS-based fields (tag_id, affected_area)
    if (fieldDef.sqlType === 'exists') {
      return compileExistsCondition(node, fieldDef.existsSubquery!);
    }

    // has_jira_link boolean: convert to IS NULL / IS NOT NULL
    if (field === 'has_jira_link' && operator === 'eq') {
      const boolVal = value as boolean;
      return boolVal
        ? `${fieldDef.columnExpr} IS NOT NULL`
        : `${fieldDef.columnExpr} IS NULL`;
    }

    // Contains: ILIKE with escaped wildcards
    if (operator === 'contains') {
      const escaped = escapeLike(String(value));
      const placeholder = push(`%${escaped}%`);
      return `${fieldDef.columnExpr} ILIKE ${placeholder}`;
    }

    // between
    if (operator === 'between') {
      const [start, end] = resolveDateRange(value, clock);
      const p1 = push(start);
      const p2 = push(end);
      return `${fieldDef.columnExpr} BETWEEN ${p1} AND ${p2}`;
    }

    // in / not_in
    if (operator === 'in' || operator === 'not_in') {
      const arr = value as unknown[];
      const placeholder = push(arr);
      return operator === 'in'
        ? `${fieldDef.columnExpr} = ANY(${placeholder})`
        : `${fieldDef.columnExpr} != ALL(${placeholder})`;
    }

    // Scalar comparisons: eq, neq, gt, gte, lt, lte
    const resolvedValue = resolveScalarDateIfNeeded(field, value, clock);
    const placeholder = push(resolvedValue);
    return compileScalarOp(fieldDef.columnExpr, operator, placeholder);
  }

  function compileExistsCondition(node: ConditionNode, template: string): string {
    const { value } = node;
    const arr = Array.isArray(value) ? value : [value];
    const placeholder = push(arr);
    return template.replace('{placeholder}', placeholder);
  }

  const sql = compileNode(ast);
  return { sql, params };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function compileScalarOp(col: string, op: string, placeholder: string): string {
  switch (op) {
    case 'eq': return `${col} = ${placeholder}`;
    case 'neq': return `${col} != ${placeholder}`;
    case 'gt': return `${col} > ${placeholder}`;
    case 'gte': return `${col} >= ${placeholder}`;
    case 'lt': return `${col} < ${placeholder}`;
    case 'lte': return `${col} <= ${placeholder}`;
    default:
      throw Object.assign(
        new Error(`[filter-compiler] PROGRAMMER_ERROR: unhandled scalar operator "${op}"`),
        { code: AstErrorCode.PROGRAMMER_ERROR },
      );
  }
}

/**
 * Escapes percent and underscore in LIKE patterns.
 * Also escapes the escape character itself (backslash).
 */
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function resolveScalarDateIfNeeded(
  field: string,
  value: unknown,
  clock: Clock,
): unknown {
  const fieldDef = getFieldDef(field);
  if (!fieldDef || fieldDef.sqlType !== 'timestamp') return value;
  if (!isRelativeDateToken(value)) return value;
  // For scalar operators on date fields, use the start of the resolved range
  const [start] = resolveRelativeToken(value as RelativeDateToken, clock);
  return start;
}

function resolveDateRange(value: unknown, clock: Clock): [unknown, unknown] {
  if (isRelativeDateToken(value)) {
    return resolveRelativeToken(value as RelativeDateToken, clock);
  }
  if (Array.isArray(value) && value.length === 2) {
    const start = isRelativeDateToken(value[0])
      ? resolveRelativeToken(value[0] as RelativeDateToken, clock)[0]
      : value[0];
    const end = isRelativeDateToken(value[1])
      ? resolveRelativeToken(value[1] as RelativeDateToken, clock)[1]
      : value[1];
    return [start, end];
  }
  throw Object.assign(
    new Error('[filter-compiler] PROGRAMMER_ERROR: invalid between value post-validation'),
    { code: AstErrorCode.PROGRAMMER_ERROR },
  );
}
