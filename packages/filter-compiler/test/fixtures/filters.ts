/**
 * Committed corpus of valid and malicious filter ASTs.
 * Used by both unit tests (compile.test.ts) and the integration test suite.
 *
 * ADVERSARIAL section contains inputs that must be rejected or appear only in params
 * (never interpolated into the SQL string).
 */

import { type FilterAst } from '../../src/ast';

// ---------------------------------------------------------------------------
// Valid ASTs
// ---------------------------------------------------------------------------

export const SIMPLE_STATUS_EQ: FilterAst = {
  type: 'condition',
  field: 'status',
  operator: 'eq',
  value: 'open',
};

export const SIMPLE_PRIORITY_IN: FilterAst = {
  type: 'condition',
  field: 'priority',
  operator: 'in',
  value: ['P1', 'P2'],
};

export const AND_GROUP: FilterAst = {
  type: 'group',
  op: 'and',
  children: [
    { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
    { type: 'condition', field: 'priority', operator: 'eq', value: 'P1' },
  ],
};

export const OR_GROUP: FilterAst = {
  type: 'group',
  op: 'or',
  children: [
    { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
    { type: 'condition', field: 'status', operator: 'eq', value: 'in_progress' },
  ],
};

export const NESTED_GROUP: FilterAst = {
  type: 'group',
  op: 'and',
  children: [
    { type: 'condition', field: 'organization_id', operator: 'eq', value: '00000000-0000-0000-0000-000000000001' },
    {
      type: 'group',
      op: 'or',
      children: [
        { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
        { type: 'condition', field: 'status', operator: 'eq', value: 'in_progress' },
      ],
    },
  ],
};

export const TAG_EXISTS: FilterAst = {
  type: 'condition',
  field: 'tag_id',
  operator: 'eq',
  value: '00000000-0000-0000-0000-000000000002',
};

export const TAG_IN_ARRAY: FilterAst = {
  type: 'condition',
  field: 'tag_id',
  operator: 'in',
  value: ['00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003'],
};

export const DATE_RANGE: FilterAst = {
  type: 'condition',
  field: 'created_at',
  operator: 'between',
  value: ['2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z'],
};

export const RELATIVE_DATE: FilterAst = {
  type: 'condition',
  field: 'created_at',
  operator: 'gte',
  value: 'last_7_days',
};

export const TEXT_CONTAINS: FilterAst = {
  type: 'condition',
  field: 'category_path',
  operator: 'contains',
  value: 'billing',
};

export const IS_NULL_CHECK: FilterAst = {
  type: 'condition',
  field: 'resolved_at',
  operator: 'is_null',
  value: null,
};

export const HAS_JIRA_LINK: FilterAst = {
  type: 'condition',
  field: 'has_jira_link',
  operator: 'eq',
  value: true,
};

export const EMPTY_AND_GROUP: FilterAst = {
  type: 'group',
  op: 'and',
  children: [],
};

export const SLA_STATE_IN: FilterAst = {
  type: 'condition',
  field: 'sla_state',
  operator: 'in',
  value: ['warning', 'breached'],
};

// ---------------------------------------------------------------------------
// Expected compile outcomes for valid ASTs (for assertions)
// ---------------------------------------------------------------------------

export interface ExpectedOutcome {
  ast: FilterAst;
  sqlContains: string[];  // substrings that MUST appear in sql
  paramCount: number;
}

export const VALID_OUTCOMES: ExpectedOutcome[] = [
  {
    ast: SIMPLE_STATUS_EQ,
    sqlContains: ['"tickets"."status"', '=', '$1'],
    paramCount: 1,
  },
  {
    ast: SIMPLE_PRIORITY_IN,
    sqlContains: ['"tickets"."priority"', 'IN', '$1', '$2'],
    paramCount: 2,
  },
  {
    ast: TAG_EXISTS,
    sqlContains: ['EXISTS', 'ticket_tags', 'ticket_id', '$1'],
    paramCount: 1,
  },
  {
    ast: DATE_RANGE,
    sqlContains: ['BETWEEN', '$1', '$2'],
    paramCount: 2,
  },
  {
    ast: TEXT_CONTAINS,
    sqlContains: ['ILIKE', '$1'],
    paramCount: 1,
  },
  {
    ast: EMPTY_AND_GROUP,
    sqlContains: ['TRUE'],
    paramCount: 0,
  },
  {
    ast: IS_NULL_CHECK,
    sqlContains: ['IS NULL'],
    paramCount: 0,
  },
];

// ---------------------------------------------------------------------------
// ADVERSARIAL: must be REJECTED by validateFilterAst
// ---------------------------------------------------------------------------

/** Unknown field — should be rejected with UNKNOWN_FIELD */
export const UNKNOWN_FIELD_AST: unknown = {
  type: 'condition',
  field: 'raw_sql_injection',
  operator: 'eq',
  value: '1',
};

/** Unknown operator — should be rejected with OPERATOR_NOT_ALLOWED */
export const UNKNOWN_OPERATOR_AST: unknown = {
  type: 'condition',
  field: 'status',
  operator: 'raw_sql',
  value: 'open',
};

/** Operator not allowed on field — priority does not support gt */
export const WRONG_OPERATOR_AST: unknown = {
  type: 'condition',
  field: 'priority',
  operator: 'gt',
  value: 'P1',
};

/** Empty IN array — should be rejected with EMPTY_IN_ARRAY */
export const EMPTY_IN_ARRAY_AST: unknown = {
  type: 'condition',
  field: 'status',
  operator: 'in',
  value: [],
};

/** Extra unknown property — Zod strict() should reject */
export const EXTRA_PROPERTY_AST: unknown = {
  type: 'condition',
  field: 'status',
  operator: 'eq',
  value: 'open',
  inject: '1; DROP TABLE tickets; --',
};

/** Depth exceeded — 5 levels deep (MAX_DEPTH is 4) */
export const DEPTH_EXCEEDED_AST: unknown = {
  type: 'group',
  op: 'and',
  children: [{
    type: 'group',
    op: 'and',
    children: [{
      type: 'group',
      op: 'and',
      children: [{
        type: 'group',
        op: 'and',
        children: [{
          type: 'group',
          op: 'and',
          children: [
            { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
          ],
        }],
      }],
    }],
  }],
};

// ---------------------------------------------------------------------------
// ADVERSARIAL: values that must appear in params only, never in SQL string
// Compile these AFTER passing validation with a benign AST wrapper.
// ---------------------------------------------------------------------------

/** SQL injection in category_path value — must be in params, not SQL */
export const SQL_INJECTION_IN_VALUE: FilterAst = {
  type: 'condition',
  field: 'category_path',
  operator: 'contains',
  value: "billing'; DROP TABLE tickets; --",
};

/** SQL comment in value — must be in params */
export const COMMENT_INJECTION: FilterAst = {
  type: 'condition',
  field: 'category_path',
  operator: 'eq',
  value: "normal /* hidden injection */ value",
};

/** Unicode SQL bypass attempt */
export const UNICODE_INJECTION: FilterAst = {
  type: 'condition',
  field: 'category_path',
  operator: 'eq',
  value: "val'ue",  // unicode single quote
};

/** Semicolon injection in category_path */
export const SEMICOLON_INJECTION: FilterAst = {
  type: 'condition',
  field: 'category_path',
  operator: 'eq',
  value: "value; SELECT * FROM users",
};

/** Double-dash comment in value */
export const DOUBLE_DASH_INJECTION: FilterAst = {
  type: 'condition',
  field: 'category_path',
  operator: 'eq',
  value: "value -- comment",
};

/** LIKE wildcard in contains value — must be escaped */
export const LIKE_WILDCARD_VALUE: FilterAst = {
  type: 'condition',
  field: 'category_path',
  operator: 'contains',
  value: "50% off",  // % must be escaped to \\%
};

export const LIKE_UNDERSCORE_VALUE: FilterAst = {
  type: 'condition',
  field: 'category_path',
  operator: 'contains',
  value: "user_name",  // _ must be escaped to \\_
};

/** Invalid UUID for uuid-typed field */
export const INVALID_UUID: unknown = {
  type: 'condition',
  field: 'organization_id',
  operator: 'eq',
  value: 'not-a-uuid',
};

/** Invalid enum value */
export const INVALID_STATUS_ENUM: unknown = {
  type: 'condition',
  field: 'status',
  operator: 'eq',
  value: 'hacked',
};

/** Invalid ISO date */
export const INVALID_DATE: unknown = {
  type: 'condition',
  field: 'created_at',
  operator: 'gte',
  value: 'not-a-date',
};
