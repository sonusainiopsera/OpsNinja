/**
 * Report-specific filter AST schema.
 *
 * Builds on the structural types from @opsninja/filter-compiler but validates
 * fields and operators against the REPORT DIMENSION CATALOG, not the general
 * FIELD_REGISTRY used for ticket list views.
 *
 * Error codes are reporting-domain-specific so callers can emit structured 400
 * responses with precise paths.
 */

import {
  parseFilterAst,
  countConditions,
  getDepth,
  type FilterAst,
  type AstNode,
  type ConditionNode,
  MAX_DEPTH,
  MAX_CONDITIONS,
} from '@opsninja/filter-compiler';

import {
  getDimensionDef,
  isKnownDimension,
  REPORT_OPERATOR_SET,
} from './report-field-catalog';

// ── Error codes ────────────────────────────────────────────────────────────────

export const ReportFilterErrorCode = {
  REPORT_FILTER_INVALID_FIELD: 'REPORT_FILTER_INVALID_FIELD',
  REPORT_FILTER_INVALID_OPERATOR: 'REPORT_FILTER_INVALID_OPERATOR',
  REPORT_FILTER_TYPE_MISMATCH: 'REPORT_FILTER_TYPE_MISMATCH',
  REPORT_FILTER_TOO_DEEP: 'REPORT_FILTER_TOO_DEEP',
  REPORT_FILTER_TOO_LARGE: 'REPORT_FILTER_TOO_LARGE',
  REPORT_FILTER_PARSE_ERROR: 'REPORT_FILTER_PARSE_ERROR',
} as const;

export type ReportFilterErrorCode =
  (typeof ReportFilterErrorCode)[keyof typeof ReportFilterErrorCode];

export interface ReportFilterError {
  path: string[];
  code: ReportFilterErrorCode;
  message: string;
}

export interface ReportFilterValidationResult {
  ok: boolean;
  errors: ReportFilterError[];
  ast?: FilterAst;
}

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Validates a raw value as a report filter AST.
 *
 * Phase 1: structural parse (via filter-compiler parseFilterAst)
 * Phase 2: report-domain semantic validation against DIMENSION_CATALOG
 *
 * @param raw   Untrusted JSON value from request body
 * @param opts  Override depth/count limits for testing
 */
export function validateReportFilterAst(
  raw: unknown,
  opts: { maxDepth?: number; maxConditions?: number } = {},
): ReportFilterValidationResult {
  if (raw === null || raw === undefined) {
    return { ok: true, errors: [], ast: undefined };
  }

  const maxDepth = opts.maxDepth ?? MAX_DEPTH;
  const maxConditions = opts.maxConditions ?? MAX_CONDITIONS;

  // Phase 1: structural parse
  const parsed = parseFilterAst(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      errors: parsed.errors.map(e => ({
        path: e.path,
        code: ReportFilterErrorCode.REPORT_FILTER_PARSE_ERROR,
        message: e.message,
      })),
    };
  }

  const ast = parsed.ast;
  const errors: ReportFilterError[] = [];

  // Depth guard
  const depth = getDepth(ast);
  if (depth > maxDepth) {
    errors.push({
      path: [],
      code: ReportFilterErrorCode.REPORT_FILTER_TOO_DEEP,
      message: `Filter nesting depth ${depth} exceeds maximum of ${maxDepth}.`,
    });
  }

  // Node count guard
  const condCount = countConditions(ast);
  if (condCount > maxConditions) {
    errors.push({
      path: [],
      code: ReportFilterErrorCode.REPORT_FILTER_TOO_LARGE,
      message: `Filter has ${condCount} condition nodes; maximum is ${maxConditions}.`,
    });
  }

  // Per-condition semantic validation
  walkNode(ast, [], errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], ast };
}

function walkNode(node: AstNode, path: string[], errors: ReportFilterError[]): void {
  if (node.type === 'group') {
    node.children.forEach((child, i) =>
      walkNode(child, [...path, 'children', String(i)], errors),
    );
    return;
  }
  validateCondition(node, path, errors);
}

function validateCondition(
  node: ConditionNode,
  path: string[],
  errors: ReportFilterError[],
): void {
  const { field, operator, value } = node;

  if (!isKnownDimension(field)) {
    errors.push({
      path: [...path, 'field'],
      code: ReportFilterErrorCode.REPORT_FILTER_INVALID_FIELD,
      message: `Field "${field}" is not in the reporting dimension catalog. Only allow-listed fields may be filtered.`,
    });
    return;
  }

  if (!REPORT_OPERATOR_SET.has(operator)) {
    errors.push({
      path: [...path, 'operator'],
      code: ReportFilterErrorCode.REPORT_FILTER_INVALID_OPERATOR,
      message: `Operator "${operator}" is not a valid reporting operator.`,
    });
    return;
  }

  const dim = getDimensionDef(field)!;

  if (!(dim.allowedOperators as readonly string[]).includes(operator)) {
    errors.push({
      path: [...path, 'operator'],
      code: ReportFilterErrorCode.REPORT_FILTER_INVALID_OPERATOR,
      message: `Operator "${operator}" is not allowed for field "${field}". Allowed: ${dim.allowedOperators.join(', ')}.`,
    });
    return;
  }

  // Null operators require no value
  if (operator === 'is_null' || operator === 'is_not_null') return;

  // in / not_in: non-empty array required
  if (operator === 'in' || operator === 'not_in') {
    if (!Array.isArray(value) || value.length === 0) {
      errors.push({
        path: [...path, 'value'],
        code: ReportFilterErrorCode.REPORT_FILTER_TYPE_MISMATCH,
        message: `Operator "${operator}" requires a non-empty array for field "${field}".`,
      });
      return;
    }
  }

  // between: 2-element tuple or relative date token
  if (operator === 'between') {
    const isToken = typeof value === 'string';
    const isTuple = Array.isArray(value) && value.length === 2;
    if (!isToken && !isTuple) {
      errors.push({
        path: [...path, 'value'],
        code: ReportFilterErrorCode.REPORT_FILTER_TYPE_MISMATCH,
        message: `Operator "between" requires a [start, end] tuple or a relative date token for field "${field}".`,
      });
      return;
    }
    if (isTuple && dim.dataType === 'timestamp') {
      // Validate that both bounds parse as dates
      const [start, end] = value as [unknown, unknown];
      if (
        typeof start === 'string' &&
        typeof end === 'string' &&
        start > end &&
        !start.startsWith('last_') && !start.startsWith('this_') &&
        !end.startsWith('last_') && !end.startsWith('this_')
      ) {
        errors.push({
          path: [...path, 'value'],
          code: ReportFilterErrorCode.REPORT_FILTER_TYPE_MISMATCH,
          message: `"between" bounds are reversed for field "${field}": start "${start}" must not be after end "${end}".`,
        });
        return;
      }
    }
  }

  // Value schema validation
  const result = dim.valueSchema.safeParse(value);
  if (!result.success) {
    errors.push({
      path: [...path, 'value'],
      code: ReportFilterErrorCode.REPORT_FILTER_TYPE_MISMATCH,
      message: `Invalid value for field "${field}": ${result.error.errors[0]?.message ?? 'validation failed'}.`,
    });
  }
}
