/**
 * Semantic validation of FilterAst.
 *
 * Layers field-registry checks on top of the structural Zod parse:
 *   - Unknown fields → UNKNOWN_FIELD
 *   - Operator not allowed for field → OPERATOR_NOT_ALLOWED
 *   - Value fails field value schema → INVALID_VALUE
 *   - Empty array for in/not_in → EMPTY_IN_ARRAY
 *   - Depth > MAX_DEPTH → DEPTH_EXCEEDED
 *   - condition count > MAX_NODES → NODE_COUNT_EXCEEDED
 *
 * Returns a typed ValidationResult — never throws on bad input.
 */

import {
  parseAstStructure,
  countNodes,
  maxDepth,
  MAX_DEPTH,
  MAX_NODES,
  type FilterAst,
  type FilterNode,
} from './ast';
import { type ValidationError, type ValidationResult } from './errors';
import {
  FIELD_REGISTRY,
  isKnownField,
} from './field-registry';
import {
  ARRAY_OPERATORS,
  NULL_CHECK_OPERATORS,
  RANGE_OPERATORS,
} from './operators';

// ---------------------------------------------------------------------------
// Semantic validation walk
// ---------------------------------------------------------------------------

function validateNode(
  node: FilterNode,
  errors: ValidationError[],
  path: string,
): void {
  if (node.type === 'condition') {
    if (!isKnownField(node.field)) {
      errors.push({
        path: `${path}.field`,
        message: `Unknown field "${node.field}". Allowed fields: ${Object.keys(FIELD_REGISTRY).join(', ')}`,
        code: 'UNKNOWN_FIELD',
      });
      return; // No point checking operator/value for unknown field
    }

    const entry = FIELD_REGISTRY[node.field];

    if (!(entry.allowedOperators as readonly string[]).includes(node.operator)) {
      errors.push({
        path: `${path}.operator`,
        message: `Operator "${node.operator}" is not allowed on field "${node.field}". Allowed: ${entry.allowedOperators.join(', ')}`,
        code: 'OPERATOR_NOT_ALLOWED',
      });
      return;
    }

    const op = node.operator;

    // null checks have no value
    if (NULL_CHECK_OPERATORS.has(op as 'is_null' | 'is_not_null')) return;

    // Array operators
    if (ARRAY_OPERATORS.has(op as 'in' | 'not_in')) {
      if (!Array.isArray(node.value) || node.value.length === 0) {
        errors.push({
          path: `${path}.value`,
          message: `Operator "${op}" requires a non-empty array`,
          code: 'EMPTY_IN_ARRAY',
        });
        return;
      }
      const schema = entry.arrayValueSchema ?? entry.scalarValueSchema.array().min(1);
      const result = schema.safeParse(node.value);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            path: `${path}.value.${issue.path.join('.')}`,
            message: issue.message,
            code: 'INVALID_VALUE',
          });
        }
      }
      return;
    }

    // Between operator
    if (RANGE_OPERATORS.has(op as 'between')) {
      if (!Array.isArray(node.value) || node.value.length !== 2) {
        errors.push({
          path: `${path}.value`,
          message: '"between" requires exactly two values [lower, upper]',
          code: 'INVALID_VALUE',
        });
        return;
      }
      if (entry.rangeValueSchema) {
        const result = entry.rangeValueSchema.safeParse(node.value);
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push({
              path: `${path}.value.${issue.path.join('.')}`,
              message: issue.message,
              code: 'INVALID_VALUE',
            });
          }
        }
      }
      return;
    }

    // Scalar value validation
    const result = entry.scalarValueSchema.safeParse(node.value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          path: `${path}.value`,
          message: issue.message,
          code: 'INVALID_VALUE',
        });
      }
    }
    return;
  }

  // Group node: recurse into children
  for (let i = 0; i < node.children.length; i++) {
    validateNode(node.children[i], errors, `${path}.children[${i}]`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse unknown input and perform full semantic validation.
 * Returns a ValidationResult — never throws.
 */
export function parseFilterAst(input: unknown): ValidationResult<FilterAst> {
  // Step 1: structural parse (Zod)
  const structural = parseAstStructure(input);
  if (!structural.success) {
    return {
      success: false,
      errors: structural.issues.map((issue) => ({
        path: issue.path.join('.') || 'root',
        message: issue.message,
        code: 'INVALID_STRUCTURE',
      })),
    };
  }

  return validateFilterAst(structural.data);
}

/**
 * Re-validate a structurally-correct FilterAst (e.g., loaded from DB).
 * Returns a ValidationResult — never throws.
 */
export function validateFilterAst(ast: FilterAst): ValidationResult<FilterAst> {
  const errors: ValidationError[] = [];

  // Depth limit
  const depth = maxDepth(ast);
  if (depth > MAX_DEPTH) {
    errors.push({
      path: 'root',
      message: `Filter AST exceeds maximum depth of ${MAX_DEPTH} (found ${depth})`,
      code: 'DEPTH_EXCEEDED',
    });
  }

  // Node count limit
  const nodeCount = countNodes(ast);
  if (nodeCount > MAX_NODES) {
    errors.push({
      path: 'root',
      message: `Filter AST exceeds maximum of ${MAX_NODES} condition nodes (found ${nodeCount})`,
      code: 'NODE_COUNT_EXCEEDED',
    });
  }

  // Semantic field/operator/value validation
  validateNode(ast, errors, 'root');

  if (errors.length > 0) return { success: false, errors };
  return { success: true, data: ast };
}
