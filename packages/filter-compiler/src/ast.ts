import { z } from 'zod';

export const MAX_DEPTH = 4;
export const MAX_CONDITIONS = 50;

// ── Condition node ────────────────────────────────────────────────────────────

export const ConditionNodeSchema = z
  .object({
    type: z.literal('condition'),
    field: z.string().min(1, 'field must not be empty'),
    operator: z.string().min(1, 'operator must not be empty'),
    value: z.unknown(),
  })
  .strict();

export type ConditionNode = z.infer<typeof ConditionNodeSchema>;

// ── Group node (recursive) ────────────────────────────────────────────────────

export interface GroupNode {
  type: 'group';
  op: 'and' | 'or';
  children: AstNode[];
}

// Recursive schema: GroupNodeSchema → lazy AstNodeSchema
export const GroupNodeSchema: z.ZodType<GroupNode> = z.lazy(() =>
  z
    .object({
      type: z.literal('group'),
      op: z.enum(['and', 'or']),
      children: z.array(AstNodeSchema),
    })
    .strict(),
);

export type AstNode = GroupNode | ConditionNode;

export const AstNodeSchema: z.ZodType<AstNode> = z.lazy(() =>
  z.union([GroupNodeSchema, ConditionNodeSchema]),
);

// ── Root filter AST ───────────────────────────────────────────────────────────

export const FilterAstSchema = AstNodeSchema;
export type FilterAst = AstNode;

// ── Validation error types ────────────────────────────────────────────────────

export const AstErrorCode = {
  PARSE_ERROR: 'PARSE_ERROR',
  DEPTH_EXCEEDED: 'DEPTH_EXCEEDED',
  CONDITION_LIMIT_EXCEEDED: 'CONDITION_LIMIT_EXCEEDED',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  OPERATOR_NOT_ALLOWED: 'OPERATOR_NOT_ALLOWED',
  INVALID_VALUE: 'INVALID_VALUE',
  EMPTY_IN_ARRAY: 'EMPTY_IN_ARRAY',
  PROGRAMMER_ERROR: 'PROGRAMMER_ERROR',
} as const;

export type AstErrorCode = (typeof AstErrorCode)[keyof typeof AstErrorCode];

export interface AstValidationError {
  path: string[];
  code: AstErrorCode;
  message: string;
}

export interface ValidationFailure {
  ok: false;
  errors: AstValidationError[];
}

export interface ValidationSuccess {
  ok: true;
  ast: FilterAst;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

// ── Parse result (structural only — no field/op semantics) ───────────────────

export interface ParseSuccess {
  ok: true;
  ast: FilterAst;
}

export interface ParseFailure {
  ok: false;
  errors: AstValidationError[];
}

export type ParseResult = ParseSuccess | ParseFailure;

/**
 * Counts the total number of condition nodes in an AST recursively.
 */
export function countConditions(node: AstNode): number {
  if (node.type === 'condition') return 1;
  return node.children.reduce((n, child) => n + countConditions(child), 0);
}

/**
 * Returns the maximum nesting depth of an AST (a single condition node has depth 0).
 */
export function getDepth(node: AstNode, current = 0): number {
  if (node.type === 'condition') return current;
  if (node.children.length === 0) return current;
  return Math.max(...node.children.map(c => getDepth(c, current + 1)));
}
