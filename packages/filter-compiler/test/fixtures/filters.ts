import type { FilterAst } from '../../src/ast';

// ── Valid filter ASTs ─────────────────────────────────────────────────────────

export const simpleEqStatus: FilterAst = {
  type: 'condition',
  field: 'status',
  operator: 'eq',
  value: 'open',
};

export const simpleInPriority: FilterAst = {
  type: 'condition',
  field: 'priority',
  operator: 'in',
  value: ['p1', 'p2'],
};

export const groupAndFilter: FilterAst = {
  type: 'group',
  op: 'and',
  children: [
    { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
    { type: 'condition', field: 'priority', operator: 'in', value: ['p1', 'p2'] },
  ],
};

export const groupOrFilter: FilterAst = {
  type: 'group',
  op: 'or',
  children: [
    { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
    { type: 'condition', field: 'status', operator: 'eq', value: 'in_progress' },
  ],
};

export const nestedGroupFilter: FilterAst = {
  type: 'group',
  op: 'and',
  children: [
    { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
    {
      type: 'group',
      op: 'or',
      children: [
        { type: 'condition', field: 'priority', operator: 'eq', value: 'p1' },
        { type: 'condition', field: 'priority', operator: 'eq', value: 'p2' },
      ],
    },
  ],
};

export const nullCheckFilter: FilterAst = {
  type: 'condition',
  field: 'resolved_at',
  operator: 'is_null',
  value: null,
};

export const dateRangeFilter: FilterAst = {
  type: 'condition',
  field: 'created_at',
  operator: 'between',
  value: ['2024-01-01', '2024-12-31'],
};

export const relativeDateFilter: FilterAst = {
  type: 'condition',
  field: 'created_at',
  operator: 'between',
  value: 'last_7_days',
};

export const containsFilter: FilterAst = {
  type: 'condition',
  field: 'category_path',
  operator: 'contains',
  value: 'infrastructure',
};

export const tagIdFilter: FilterAst = {
  type: 'condition',
  field: 'tag_id',
  operator: 'in',
  value: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
};

export const orgFilter: FilterAst = {
  type: 'condition',
  field: 'organization_id',
  operator: 'eq',
  value: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
};

export const hasJiraFilter: FilterAst = {
  type: 'condition',
  field: 'has_jira_link',
  operator: 'eq',
  value: true,
};

export const emptyGroupFilter: FilterAst = {
  type: 'group',
  op: 'and',
  children: [],
};

export const slaStateFilter: FilterAst = {
  type: 'condition',
  field: 'sla_state',
  operator: 'in',
  value: ['warning', 'breached'],
};

// ── Adversarial / invalid inputs ──────────────────────────────────────────────

/** Raw JSON input with an unknown field — must be rejected */
export const unknownFieldRaw = {
  type: 'condition',
  field: 'DROP TABLE tickets;--',
  operator: 'eq',
  value: 'open',
};

/** Unknown operator — must be rejected */
export const unknownOperatorRaw = {
  type: 'condition',
  field: 'status',
  operator: "'; DROP TABLE tickets;--",
  value: 'open',
};

/** SQL injection attempt in value — must appear only in params, never in sql string */
export const sqlInjectionValueRaw = {
  type: 'condition',
  field: 'organization_id',
  operator: 'eq',
  value: "' OR '1'='1",
};

/** SQL comment injection in value */
export const sqlCommentValueRaw = {
  type: 'condition',
  field: 'category_path',
  operator: 'contains',
  value: '-- DROP TABLE',
};

/** Semicolon injection in value */
export const semicolonInjection = {
  type: 'condition',
  field: 'status',
  operator: 'eq',
  value: "open; DELETE FROM tickets WHERE '1'='1",
};

/** Unicode escape in value */
export const unicodeEscapeInjection = {
  type: 'condition',
  field: 'category_path',
  operator: 'contains',
  value: '' OR 1=1 --',
};

/** LIKE wildcard injection in contains value — must be escaped */
export const likeWildcardValue = {
  type: 'condition',
  field: 'category_path',
  operator: 'contains',
  value: '100% done',
};

/** operator not allowed for field */
export const operatorMismatch = {
  type: 'condition',
  field: 'status',
  operator: 'contains', // not allowed for enum field
  value: 'open',
};

/** in with empty array — must be rejected */
export const emptyInArray = {
  type: 'condition',
  field: 'status',
  operator: 'in',
  value: [],
};

/** between with wrong tuple size — must be rejected */
export const invalidBetweenTuple = {
  type: 'condition',
  field: 'created_at',
  operator: 'between',
  value: ['2024-01-01'], // only one element
};

/** Nested object as value — must be rejected by value schema */
export const nestedObjectValue = {
  type: 'condition',
  field: 'status',
  operator: 'eq',
  value: { $where: 'true' },
};

/** Too deeply nested AST — must fail depth check */
export function buildDeepAst(depth: number): unknown {
  let node: unknown = { type: 'condition', field: 'status', operator: 'eq', value: 'open' };
  for (let i = 0; i < depth; i++) {
    node = { type: 'group', op: 'and', children: [node] };
  }
  return node;
}

/** AST exceeding node count limit */
export function buildWideAst(conditionCount: number): unknown {
  return {
    type: 'group',
    op: 'and',
    children: Array.from({ length: conditionCount }, () => ({
      type: 'condition',
      field: 'status',
      operator: 'eq',
      value: 'open',
    })),
  };
}

/** Extra properties in AST node — must be rejected by .strict() */
export const extraPropsRaw = {
  type: 'condition',
  field: 'status',
  operator: 'eq',
  value: 'open',
  injected: 'DROP TABLE',
};
