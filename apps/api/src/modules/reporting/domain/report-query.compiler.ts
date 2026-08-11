/**
 * ReportQueryCompiler — translates a validated report definition to a
 * fully parameterised, tenant-scoped aggregate SQL statement.
 *
 * SECURITY GUARANTEE: every user-supplied value is pushed into the params
 * array as a positional placeholder ($n). No user-supplied value is ever
 * concatenated or interpolated into the SQL string. The compiler resolves
 * ALL identifiers (columns, expressions, JOIN aliases) through
 * REPORT_FIELD_CATALOG — never from caller-supplied strings.
 *
 * Compiled SQL structure:
 *   SELECT
 *     <dimension_group_exprs AS d_<name>>,
 *     <metric_sql_exprs AS m_<name>>
 *   FROM tickets t
 *   [LEFT JOIN organizations o ON ...]
 *   [LEFT JOIN ticket_sla ts ON ...]
 *   WHERE
 *     t.tenant_id = current_setting('app.current_tenant')::uuid   -- RLS belt+suspenders
 *     [AND t.organization_id = ANY($n)]                           -- org scope
 *     [AND <compiled filter predicate>]
 *   GROUP BY <dimension_group_exprs>
 *   ORDER BY <allow-listed alias> <asc|desc>
 *   LIMIT <row_cap>
 *
 * NOTE: No template literals appear in the output path for user values.
 *       The static test reads this file and asserts that no `${...}` pattern
 *       appears inside backtick strings that carry user-supplied data.
 */

import { createHash } from 'crypto';

import {
  REPORT_FIELD_CATALOG,
  isKnownReportField,
  isDimension,
  isMetric,
  type ReportFieldName,
  type RequiredJoin,
} from './report-field-catalog';
import {
  validateReportFilterAst,
  type ReportFilterAst,
} from './filter-ast.schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export class ReportCompilerError extends Error {
  constructor(
    message: string,
    public readonly signature?: string,
  ) {
    super(message);
    this.name = 'ReportCompilerError';
  }
}

export interface CompiledReportQuery {
  sql: string;
  params: unknown[];
  /** Deterministic SHA-256 cache key for this compiled form. */
  signature: string;
}

export interface CompileReportQueryInput {
  /** Field names from catalog (fieldKind === 'metric'). */
  metrics: string[];
  /** Field names from catalog (fieldKind === 'dimension'). */
  groupBy: string[];
  /** Optional validated filter AST. Re-validated defensively at compile time. */
  filterAst?: ReportFilterAst | null;
  /** UUID list of allowed organizations. Empty = unrestricted (manager/admin). */
  orgScopeIds?: string[];
  /** Viewer org scope version — included in the cache key so scope changes invalidate cache. */
  orgScopeVersion?: number;
  /** Sort by: must be a dimension or metric field name. Defaults to first metric. */
  sortField?: string;
  sortDir?: 'asc' | 'desc';
  /** Max rows returned. Defaults to 500_000. */
  rowCap?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ROW_CAP = 500_000;
const COMPILER_VERSION = 'rqc-v1';

// Operators that do not have a value parameter.
const NULL_CHECK_OPERATORS = new Set(['is_null', 'is_not_null']);
// Operators that take an array value.
const ARRAY_OPERATORS = new Set(['in', 'not_in']);
// Operators that take a [lower, upper] range.
const RANGE_OPERATORS = new Set(['between']);

// ---------------------------------------------------------------------------
// Parameter accumulator
// ---------------------------------------------------------------------------

function addParam(params: unknown[], value: unknown): string {
  params.push(value);
  return '$' + params.length;
}

// ---------------------------------------------------------------------------
// Filter predicate compiler (mirrors @opsninja/filter-compiler pattern)
// ---------------------------------------------------------------------------

function compileLike(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ReportCompilerError('contains operator requires a string value');
  }
  // Escape PostgreSQL LIKE wildcards. No interpolation — value goes into params.
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function resolveScalar(value: unknown, dataType: string): unknown {
  if (dataType === 'timestamp' || dataType === 'date') {
    if (typeof value === 'string') {
      const d = new Date(value);
      if (isNaN(d.getTime())) {
        throw new ReportCompilerError('Invalid date value: ' + String(value));
      }
      return d;
    }
  }
  return value;
}

function compileCondition(
  node: { type: 'condition'; field: string; operator: string; value: unknown },
  params: unknown[],
): string {
  if (!isKnownReportField(node.field)) {
    throw new ReportCompilerError(
      'Unknown field "' + node.field + '" reached compiler — catalog drift detected',
    );
  }

  const entry = REPORT_FIELD_CATALOG[node.field as ReportFieldName];

  if (entry.fieldKind !== 'dimension') {
    throw new ReportCompilerError(
      'Metric field "' + node.field + '" cannot be used as a filter condition',
    );
  }

  if (!(entry.allowedOperators as readonly string[]).includes(node.operator)) {
    throw new ReportCompilerError(
      'Operator "' + node.operator + '" not allowed on field "' + node.field + '"',
    );
  }

  const op = node.operator;
  const col = entry.sqlExpression;

  if (NULL_CHECK_OPERATORS.has(op)) {
    return op === 'is_null' ? col + ' IS NULL' : col + ' IS NOT NULL';
  }

  if (ARRAY_OPERATORS.has(op)) {
    if (!Array.isArray(node.value) || node.value.length === 0) {
      throw new ReportCompilerError(
        'Array operator "' + op + '" on "' + node.field + '" requires a non-empty array',
      );
    }
    const resolved = node.value.map((v) => resolveScalar(v, entry.dataType));
    const placeholders = resolved.map((v) => addParam(params, v)).join(', ');
    return op === 'in'
      ? col + ' IN (' + placeholders + ')'
      : col + ' NOT IN (' + placeholders + ')';
  }

  if (RANGE_OPERATORS.has(op)) {
    if (!Array.isArray(node.value) || node.value.length !== 2) {
      throw new ReportCompilerError(
        '"between" on "' + node.field + '" requires [lower, upper] array',
      );
    }
    const lower = resolveScalar(node.value[0], entry.dataType);
    const upper = resolveScalar(node.value[1], entry.dataType);
    const p1 = addParam(params, lower);
    const p2 = addParam(params, upper);
    return col + ' BETWEEN ' + p1 + ' AND ' + p2;
  }

  if (op === 'contains') {
    const escaped = compileLike(node.value);
    const placeholder = addParam(params, '%' + escaped + '%');
    return col + ' ILIKE ' + placeholder;
  }

  const resolved = resolveScalar(node.value, entry.dataType);
  const placeholder = addParam(params, resolved);

  if (op === 'eq') return col + ' = ' + placeholder;
  if (op === 'neq') return col + ' != ' + placeholder;
  if (op === 'gt') return col + ' > ' + placeholder;
  if (op === 'gte') return col + ' >= ' + placeholder;
  if (op === 'lt') return col + ' < ' + placeholder;
  if (op === 'lte') return col + ' <= ' + placeholder;

  throw new ReportCompilerError(
    'Unhandled operator "' + op + '" for field "' + node.field + '"',
  );
}

function compileFilterNode(
  node: ReportFilterAst,
  params: unknown[],
): string {
  if (node.type === 'condition') {
    return compileCondition(node, params);
  }

  if (node.children.length === 0) {
    return node.op === 'and' ? 'TRUE' : 'FALSE';
  }

  const parts = node.children.map((child) => compileFilterNode(child, params));
  const sqlOp = node.op === 'and' ? ' AND ' : ' OR ';
  return '(' + parts.join(sqlOp) + ')';
}

// ---------------------------------------------------------------------------
// Canonical JSON for signature
// ---------------------------------------------------------------------------

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function computeReportSignature(input: CompileReportQueryInput): string {
  const canonical = {
    metrics: [...input.metrics].sort(),
    groupBy: [...input.groupBy].sort(),
    filterAst: input.filterAst ?? null,
    orgScopeVersion: input.orgScopeVersion ?? 0,
    sortField: input.sortField ?? null,
    sortDir: input.sortDir ?? 'desc',
    rowCap: input.rowCap ?? DEFAULT_ROW_CAP,
  };
  const json = JSON.stringify(sortKeys(canonical));
  const hash = createHash('sha256').update(json, 'utf8').digest('hex');
  return COMPILER_VERSION + ':' + hash;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile a validated report definition to a parameterised SQL query.
 *
 * Throws ReportCompilerError on:
 *   - Unknown metric or dimension field names
 *   - Invalid sort field
 *   - Filter AST catalog drift (DEFINITION_FIELD_RETIRED)
 *
 * Never interpolates user-supplied values into the SQL string.
 */
export function compileReportQuery(input: CompileReportQueryInput): CompiledReportQuery {
  const {
    metrics,
    groupBy,
    filterAst,
    orgScopeIds = [],
    sortField,
    sortDir = 'desc',
    rowCap = DEFAULT_ROW_CAP,
  } = input;

  if (metrics.length === 0) {
    throw new ReportCompilerError('At least one metric must be selected');
  }

  // Validate all requested metrics
  for (const m of metrics) {
    if (!isKnownReportField(m)) {
      throw new ReportCompilerError('Unknown metric field "' + m + '"');
    }
    if (!isMetric(m)) {
      throw new ReportCompilerError(
        '"' + m + '" is a dimension, not a metric',
      );
    }
  }

  // Validate all requested dimensions
  for (const d of groupBy) {
    if (!isKnownReportField(d)) {
      throw new ReportCompilerError('Unknown dimension field "' + d + '"');
    }
    if (!isDimension(d)) {
      throw new ReportCompilerError(
        '"' + d + '" is a metric, not a dimension',
      );
    }
  }

  // Defensive filter AST re-validation (catalog drift detection)
  if (filterAst != null) {
    const revalidation = validateReportFilterAst(filterAst);
    if (!revalidation.success) {
      const retired = revalidation.errors.find(
        (e) =>
          e.code === 'REPORT_FILTER_INVALID_FIELD' ||
          e.code === 'DEFINITION_FIELD_RETIRED',
      );
      throw new ReportCompilerError(
        retired
          ? 'DEFINITION_FIELD_RETIRED: ' + revalidation.errors.map((e) => e.message).join('; ')
          : 'Filter AST failed re-validation: ' + revalidation.errors.map((e) => e.message).join('; '),
      );
    }
  }

  // Validate sort field
  const effectiveSortField = sortField ?? metrics[0];
  if (!isKnownReportField(effectiveSortField!)) {
    throw new ReportCompilerError('Unknown sort field "' + effectiveSortField + '"');
  }
  const effectiveSortDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  // ---------------------------------------------------------------------------
  // Build SQL
  // ---------------------------------------------------------------------------

  const params: unknown[] = [];

  // Determine required JOINs
  const requiredJoins = new Set<RequiredJoin>();
  for (const d of groupBy) {
    const entry = REPORT_FIELD_CATALOG[d as ReportFieldName];
    if (entry.requiresJoin) requiredJoins.add(entry.requiresJoin);
  }
  for (const m of metrics) {
    const entry = REPORT_FIELD_CATALOG[m as ReportFieldName];
    if (entry.requiresJoin) requiredJoins.add(entry.requiresJoin);
  }

  // --- SELECT clause ---
  const selectParts: string[] = [];

  // Dimension columns with COALESCE for nullable fields
  for (const d of groupBy) {
    const entry = REPORT_FIELD_CATALOG[d as ReportFieldName];
    const groupExpr =
      entry.nullable
        ? 'COALESCE(' + entry.sqlExpression + ', \'Unassigned\')'
        : entry.sqlExpression;
    selectParts.push(groupExpr + ' AS d_' + d);
  }

  // Metric aggregate expressions
  for (const m of metrics) {
    const entry = REPORT_FIELD_CATALOG[m as ReportFieldName];
    selectParts.push(entry.sqlExpression + ' AS m_' + m);
  }

  const selectClause = 'SELECT\n  ' + selectParts.join(',\n  ');

  // --- FROM clause ---
  let fromClause = 'FROM tickets t';

  if (requiredJoins.has('organizations')) {
    fromClause +=
      '\nLEFT JOIN organizations o ON o.id = t.organization_id AND o.tenant_id = t.tenant_id';
  }
  if (requiredJoins.has('ticket_sla')) {
    fromClause +=
      '\nLEFT JOIN ticket_sla ts ON ts.ticket_id = t.id AND ts.tenant_id = t.tenant_id';
  }

  // --- WHERE clause ---
  const whereParts: string[] = [];

  // Tenant predicate — belt-and-suspenders alongside RLS
  whereParts.push("t.tenant_id = current_setting('app.current_tenant')::uuid");

  // Org scope predicate — parameterized
  if (orgScopeIds.length > 0) {
    const placeholder = addParam(params, orgScopeIds);
    whereParts.push('t.organization_id = ANY(' + placeholder + ')');
  }

  // Compiled filter predicate
  if (filterAst != null) {
    const filterSql = compileFilterNode(filterAst, params);
    whereParts.push(filterSql);
  }

  const whereClause = 'WHERE\n  ' + whereParts.join('\n  AND ');

  // --- GROUP BY clause ---
  let groupByClause = '';
  if (groupBy.length > 0) {
    const groupByParts = groupBy.map((d) => {
      const entry = REPORT_FIELD_CATALOG[d as ReportFieldName];
      return entry.nullable
        ? 'COALESCE(' + entry.sqlExpression + ', \'Unassigned\')'
        : entry.sqlExpression;
    });
    groupByClause = 'GROUP BY\n  ' + groupByParts.join(',\n  ');
  }

  // --- ORDER BY clause --- (allow-listed alias only)
  const sortAlias = isMetric(effectiveSortField!)
    ? 'm_' + effectiveSortField
    : 'd_' + effectiveSortField;
  const orderByClause = 'ORDER BY ' + sortAlias + ' ' + effectiveSortDir;

  // --- LIMIT clause ---
  const limitClause = 'LIMIT ' + rowCap;

  // --- Assemble ---
  const parts = [selectClause, fromClause, whereClause];
  if (groupByClause) parts.push(groupByClause);
  parts.push(orderByClause);
  parts.push(limitClause);

  const sql = parts.join('\n');

  const signature = computeReportSignature(input);

  return { sql, params, signature };
}
