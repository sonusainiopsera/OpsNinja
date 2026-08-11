/**
 * Zod AST schema for filter expressions.
 *
 * The schema performs structural validation only (shape, types, depth, node counts).
 * Semantic validation (valid fields, operators, values) is performed by validateFilterAst()
 * in field-registry.ts which layers on top of this structural parse.
 *
 * z.strict() is used throughout so unknown properties cause a parse error rather
 * than being silently dropped — this prevents a stored view from containing hidden
 * fields that later become significant.
 */

import { z } from 'zod';

export const MAX_DEPTH = 4;
export const MAX_NODES = 50;

// ---------------------------------------------------------------------------
// Primitive AST node schemas
// ---------------------------------------------------------------------------

const conditionNodeSchema = z
  .object({
    type: z.literal('condition'),
    field: z.string().min(1).max(64),
    operator: z.string().min(1).max(32),
    value: z.unknown(),
  })
  .strict();

type ConditionNode = z.infer<typeof conditionNodeSchema>;

// Group nodes are recursive; Zod lazy() handles circular types.
const groupNodeSchema: z.ZodType<GroupNode> = z.lazy(() =>
  z
    .object({
      type: z.literal('group'),
      op: z.enum(['and', 'or']),
      children: z.array(filterNodeSchema).max(MAX_NODES),
    })
    .strict(),
);

export type GroupNode = {
  type: 'group';
  op: 'and' | 'or';
  children: FilterNode[];
};

const filterNodeSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.discriminatedUnion('type', [conditionNodeSchema, groupNodeSchema]),
);

export type FilterNode = ConditionNode | GroupNode;
export type ConditionNodeType = ConditionNode;

// ---------------------------------------------------------------------------
// Top-level FilterAst
// ---------------------------------------------------------------------------

export const filterAstSchema: z.ZodType<FilterAst> = z.lazy(() =>
  filterNodeSchema,
);

export type FilterAst = FilterNode;

// ---------------------------------------------------------------------------
// Structural parse (shape only, no semantic field/operator validation)
// ---------------------------------------------------------------------------

/** Parse unknown JSON into a FilterAst, enforcing structure but not field semantics. */
export function parseAstStructure(
  input: unknown,
): { success: true; data: FilterAst } | { success: false; issues: z.ZodIssue[] } {
  const result = filterAstSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, issues: result.error.issues };
}

// ---------------------------------------------------------------------------
// Depth & node-count utilities (used by validateFilterAst in field-registry.ts)
// ---------------------------------------------------------------------------

export function countNodes(node: FilterAst): number {
  if (node.type === 'condition') return 1;
  return node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

export function maxDepth(node: FilterAst, currentDepth = 0): number {
  if (node.type === 'condition') return currentDepth;
  if (node.children.length === 0) return currentDepth;
  return Math.max(...node.children.map((c) => maxDepth(c, currentDepth + 1)));
}
