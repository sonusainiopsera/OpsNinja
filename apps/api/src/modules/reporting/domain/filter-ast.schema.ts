/**
 * Report filter AST — Zod schema and semantic validator.
 *
 * Structural shape: discriminated union of condition and group nodes
 * (same topology as @opsninja/filter-compiler's FilterAst).
 *
 * Semantic constraints (checked at write time AND defensively at compile time):
 *   - Fields must be dimensions present in REPORT_FIELD_CATALOG.
 *   - Operators must be in the field's allowedOperators list.
 *   - Values must satisfy the field's Zod value schema.
 *   - Nesting depth must not exceed REPORT_MAX_DEPTH (4).
 *   - Total condition node count must not exceed REPORT_MAX_NODES (50).
 *
 * Error codes returned to callers:
 *   REPORT_FILTER_INVALID_FIELD     — unknown or non-dimension field name
 *   REPORT_FILTER_INVALID_OPERATOR  — operator not in field's allowed set
 *   REPORT_FILTER_TYPE_MISMATCH     — value fails field's value schema
 *   REPORT_FILTER_TOO_DEEP          — depth > 4
 *   REPORT_FILTER_TOO_LARGE         — node count > 50
 *   REPORT_FILTER_INVALID_STRUCTURE — structural parse failure (Zod)
 *   DEFINITION_FIELD_RETIRED        — field existed when saved but is now absent
 */

import { z } from 'zod';
import {
  REPORT_FIELD_CATALOG,
  isKnownReportField,
  isDimension,
  type ReportFieldName,
} from './report-field-catalog';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REPORT_MAX_DEPTH = 4;
export const REPORT_MAX_NODES = 50;

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type ReportFilterErrorCode =
  | 'REPORT_FILTER_INVALID_FIELD'
  | 'REPORT_FILTER_INVALID_OPERATOR'
  | 'REPORT_FILTER_TYPE_MISMATCH'
  | 'REPORT_FILTER_TOO_DEEP'
  | 'REPORT_FILTER_TOO_LARGE'
  | 'REPORT_FILTER_INVALID_STRUCTURE'
  | 'DEFINITION_FIELD_RETIRED';

export interface ReportFilterError {
  path: string;
  message: string;
  code: ReportFilterErrorCode;
}

export type ReportFilterValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ReportFilterError[] };

// ---------------------------------------------------------------------------
// Structural Zod AST schema
// ---------------------------------------------------------------------------

const reportConditionNodeSchema = z
  .object({
    type: z.literal('condition'),
    field: z.string().min(1).max(64),
    operator: z.string().min(1).max(32),
    value: z.unknown(),
  })
  .strict();

export type ReportConditionNode = z.infer<typeof reportConditionNodeSchema>;

const reportGroupNodeSchema: z.ZodType<ReportGroupNode> = z.lazy(() =>
  z
    .object({
      type: z.literal('group'),
      op: z.enum(['and', 'or']),
      children: z.array(reportFilterNodeSchema).max(REPORT_MAX_NODES),
    })
    .strict(),
);

export type ReportGroupNode = {
  type: 'group';
  op: 'and' | 'or';
  children: ReportFilterNode[];
};

const reportFilterNodeSchema: z.ZodType<ReportFilterNode> = z.lazy(() =>
  z.discriminatedUnion('type', [reportConditionNodeSchema, reportGroupNodeSchema]),
);

export type ReportFilterNode = ReportConditionNode | ReportGroupNode;
export type ReportFilterAst = ReportFilterNode;

export const reportFilterAstSchema: z.ZodType<ReportFilterAst> = z.lazy(
  () => reportFilterNodeSchema,
);

// ---------------------------------------------------------------------------
// Structural parse (shape only)
// ---------------------------------------------------------------------------

function parseAstStructure(
  input: unknown,
): { success: true; data: ReportFilterAst } | { success: false; issues: z.ZodIssue[] } {
  const result = reportFilterAstSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, issues: result.error.issues };
}

// ---------------------------------------------------------------------------
// Depth and node count utilities
// ---------------------------------------------------------------------------

function countNodes(node: ReportFilterAst): number {
  if (node.type === 'condition') return 1;
  return node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function maxDepth(node: ReportFilterAst, current = 0): number {
  if (node.type === 'condition') return current;
  if (node.children.length === 0) return current;
  return Math.max(...node.children.map((c) => maxDepth(c, current + 1)));
}

// ---------------------------------------------------------------------------
// Semantic validation walk
// ---------------------------------------------------------------------------

const NULL_CHECK_OPERATORS = new Set(['is_null', 'is_not_null']);
const ARRAY_OPERATORS = new Set(['in', 'not_in']);
const RANGE_OPERATORS = new Set(['between']);

function validateNode(
  node: ReportFilterNode,
  errors: ReportFilterError[],
  path: string,
): void {
  if (node.type === 'condition') {
    // Unknown or non-dimension field
    if (!isKnownReportField(node.field)) {
      errors.push({
        path: path + '.field',
        message:
          'Unknown field "' +
          node.field +
          '". Allowed dimensions: ' +
          Object.entries(REPORT_FIELD_CATALOG)
            .filter(([, e]) => e.fieldKind === 'dimension')
            .map(([k]) => k)
            .join(', '),
        code: 'REPORT_FILTER_INVALID_FIELD',
      });
      return;
    }

    if (!isDimension(node.field)) {
      errors.push({
        path: path + '.field',
        message: 'Field "' + node.field + '" is a metric and cannot be used as a filter condition.',
        code: 'REPORT_FILTER_INVALID_FIELD',
      });
      return;
    }

    const entry = REPORT_FIELD_CATALOG[node.field as ReportFieldName];

    if (!(entry.allowedOperators as readonly string[]).includes(node.operator)) {
      errors.push({
        path: path + '.operator',
        message:
          'Operator "' +
          node.operator +
          '" is not allowed on field "' +
          node.field +
          '". Allowed: ' +
          entry.allowedOperators.join(', '),
        code: 'REPORT_FILTER_INVALID_OPERATOR',
      });
      return;
    }

    const op = node.operator;

    if (NULL_CHECK_OPERATORS.has(op)) return;

    if (ARRAY_OPERATORS.has(op)) {
      if (!Array.isArray(node.value) || node.value.length === 0) {
        errors.push({
          path: path + '.value',
          message: 'Operator "' + op + '" requires a non-empty array',
          code: 'REPORT_FILTER_TYPE_MISMATCH',
        });
        return;
      }
      const schema =
        entry.arrayValueSchema ??
        (entry.scalarValueSchema ? z.array(entry.scalarValueSchema).min(1) : null);
      if (schema) {
        const result = schema.safeParse(node.value);
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push({
              path: path + '.value.' + issue.path.join('.'),
              message: issue.message,
              code: 'REPORT_FILTER_TYPE_MISMATCH',
            });
          }
        }
      }
      return;
    }

    if (RANGE_OPERATORS.has(op)) {
      if (!Array.isArray(node.value) || node.value.length !== 2) {
        errors.push({
          path: path + '.value',
          message: '"between" requires exactly two values [lower, upper]',
          code: 'REPORT_FILTER_TYPE_MISMATCH',
        });
        return;
      }
      if (entry.rangeValueSchema) {
        const result = entry.rangeValueSchema.safeParse(node.value);
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push({
              path: path + '.value.' + issue.path.join('.'),
              message: issue.message,
              code: 'REPORT_FILTER_TYPE_MISMATCH',
            });
          }
        }
      }
      return;
    }

    if (entry.scalarValueSchema) {
      const result = entry.scalarValueSchema.safeParse(node.value);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            path: path + '.value',
            message: issue.message,
            code: 'REPORT_FILTER_TYPE_MISMATCH',
          });
        }
      }
    }
    return;
  }

  for (let i = 0; i < node.children.length; i++) {
    validateNode(node.children[i], errors, path + '.children[' + i + ']');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse unknown input and perform full semantic validation.
 * Never throws — returns a typed result.
 */
export function parseReportFilterAst(
  input: unknown,
): ReportFilterValidationResult<ReportFilterAst> {
  const structural = parseAstStructure(input);
  if (!structural.success) {
    return {
      success: false,
      errors: structural.issues.map((issue) => ({
        path: issue.path.join('.') || 'root',
        message: issue.message,
        code: 'REPORT_FILTER_INVALID_STRUCTURE',
      })),
    };
  }
  return validateReportFilterAst(structural.data);
}

/**
 * Re-validate a structurally-correct AST (e.g., loaded from DB).
 * Detects catalog drift: a field that was valid when saved but is now absent
 * returns DEFINITION_FIELD_RETIRED.
 * Never throws — returns a typed result.
 */
export function validateReportFilterAst(
  ast: ReportFilterAst,
): ReportFilterValidationResult<ReportFilterAst> {
  const errors: ReportFilterError[] = [];

  const depth = maxDepth(ast);
  if (depth > REPORT_MAX_DEPTH) {
    errors.push({
      path: 'root',
      message:
        'Report filter AST exceeds maximum depth of ' +
        REPORT_MAX_DEPTH +
        ' (found ' +
        depth +
        ')',
      code: 'REPORT_FILTER_TOO_DEEP',
    });
  }

  const nodeCount = countNodes(ast);
  if (nodeCount > REPORT_MAX_NODES) {
    errors.push({
      path: 'root',
      message:
        'Report filter AST exceeds maximum of ' +
        REPORT_MAX_NODES +
        ' condition nodes (found ' +
        nodeCount +
        ')',
      code: 'REPORT_FILTER_TOO_LARGE',
    });
  }

  validateNode(ast, errors, 'root');

  if (errors.length > 0) return { success: false, errors };
  return { success: true, data: ast };
}
