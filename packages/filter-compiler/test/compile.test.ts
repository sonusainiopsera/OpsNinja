/**
 * compile.test.ts — exhaustive unit tests for compileToPredicate.
 *
 * Critical security assertions:
 *   - Adversarial values (quotes, semicolons, comment markers, unicode) must appear
 *     ONLY in params[], never in the sql string.
 *   - LIKE wildcards must be escaped in the sql parameter value.
 *   - EXISTS subqueries for tag_id/affected_area never join directly.
 */

import { describe, it, expect } from 'vitest';

import { compileToPredicate } from '../src/compile';
import { validateFilterAst, parseFilterAst } from '../src/validate';
import { FixedClock } from '../src/clock';
import type { FilterAst } from '../src/ast';
import {
  SIMPLE_STATUS_EQ,
  SIMPLE_PRIORITY_IN,
  AND_GROUP,
  OR_GROUP,
  NESTED_GROUP,
  TAG_EXISTS,
  TAG_IN_ARRAY,
  DATE_RANGE,
  RELATIVE_DATE,
  TEXT_CONTAINS,
  IS_NULL_CHECK,
  HAS_JIRA_LINK,
  EMPTY_AND_GROUP,
  SLA_STATE_IN,
  SQL_INJECTION_IN_VALUE,
  COMMENT_INJECTION,
  UNICODE_INJECTION,
  SEMICOLON_INJECTION,
  DOUBLE_DASH_INJECTION,
  LIKE_WILDCARD_VALUE,
  LIKE_UNDERSCORE_VALUE,
} from './fixtures/filters';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2024-06-15T12:00:00Z');
const clock = new FixedClock(FIXED_NOW);

function compile(ast: FilterAst) {
  const validated = validateFilterAst(ast);
  if (!validated.success) throw new Error(`Validation failed: ${JSON.stringify(validated.errors)}`);
  return compileToPredicate(validated.data, { clock });
}

/** Assert no SQL injection literal appears verbatim in the sql string */
function assertLiteralNotInSql(sql: string, literal: string) {
  expect(sql).not.toContain(literal);
}

// ---------------------------------------------------------------------------
// Basic operator compilation
// ---------------------------------------------------------------------------

describe('compileToPredicate — basic operators', () => {
  it('compiles eq on text_enum field', () => {
    const { sql, params } = compile(SIMPLE_STATUS_EQ);
    expect(sql).toContain('"tickets"."status"');
    expect(sql).toContain('= $1');
    expect(sql).not.toContain('open'); // value in params only
    expect(params).toEqual(['open']);
  });

  it('compiles in on text_enum field', () => {
    const { sql, params } = compile(SIMPLE_PRIORITY_IN);
    expect(sql).toContain('"tickets"."priority"');
    expect(sql).toContain('IN ($1, $2)');
    expect(sql).not.toContain('P1');
    expect(sql).not.toContain('P2');
    expect(params).toEqual(['P1', 'P2']);
  });

  it('compiles neq', () => {
    const ast: FilterAst = { type: 'condition', field: 'status', operator: 'neq', value: 'closed' };
    const { sql, params } = compile(ast);
    expect(sql).toContain('!=');
    expect(params).toEqual(['closed']);
  });

  it('compiles not_in', () => {
    const ast: FilterAst = { type: 'condition', field: 'status', operator: 'not_in', value: ['closed', 'resolved'] };
    const { sql, params } = compile(ast);
    expect(sql).toContain('NOT IN');
    expect(params).toEqual(['closed', 'resolved']);
  });

  it('compiles is_null', () => {
    const { sql, params } = compile(IS_NULL_CHECK);
    expect(sql).toContain('IS NULL');
    expect(params).toHaveLength(0);
  });

  it('compiles is_not_null', () => {
    const ast: FilterAst = { type: 'condition', field: 'resolved_at', operator: 'is_not_null', value: null };
    const { sql, params } = compile(ast);
    expect(sql).toContain('IS NOT NULL');
    expect(params).toHaveLength(0);
  });

  it('compiles gt on timestamp', () => {
    const ast: FilterAst = { type: 'condition', field: 'created_at', operator: 'gt', value: '2024-01-01T00:00:00Z' };
    const { sql, params } = compile(ast);
    expect(sql).toContain('> $1');
    expect(params[0]).toBeInstanceOf(Date);
  });

  it('compiles gte', () => {
    const ast: FilterAst = { type: 'condition', field: 'created_at', operator: 'gte', value: '2024-01-01T00:00:00Z' };
    const { sql } = compile(ast);
    expect(sql).toContain('>= $1');
  });

  it('compiles lt', () => {
    const ast: FilterAst = { type: 'condition', field: 'updated_at', operator: 'lt', value: '2024-12-31T00:00:00Z' };
    const { sql } = compile(ast);
    expect(sql).toContain('< $1');
  });

  it('compiles lte', () => {
    const ast: FilterAst = { type: 'condition', field: 'updated_at', operator: 'lte', value: '2024-12-31T00:00:00Z' };
    const { sql } = compile(ast);
    expect(sql).toContain('<= $1');
  });

  it('compiles between with two date params', () => {
    const { sql, params } = compile(DATE_RANGE);
    expect(sql).toContain('BETWEEN $1 AND $2');
    expect(params).toHaveLength(2);
    expect(params[0]).toBeInstanceOf(Date);
    expect(params[1]).toBeInstanceOf(Date);
  });

  it('compiles boolean eq', () => {
    const { sql, params } = compile(HAS_JIRA_LINK);
    expect(sql).toContain('"tickets"."has_jira_link"');
    expect(sql).toContain('= $1');
    expect(params).toEqual([true]);
  });
});

// ---------------------------------------------------------------------------
// Contains / ILIKE
// ---------------------------------------------------------------------------

describe('compileToPredicate — contains / ILIKE', () => {
  it('compiles contains to ILIKE with wildcard wrapping', () => {
    const { sql, params } = compile(TEXT_CONTAINS);
    expect(sql).toContain('ILIKE $1');
    expect(params[0]).toBe('%billing%');
    expect(sql).not.toContain('billing');
  });

  it('escapes % in contains value', () => {
    const validated = validateFilterAst(LIKE_WILDCARD_VALUE);
    if (!validated.success) throw new Error('Validation failed');
    const { params } = compileToPredicate(validated.data, { clock });
    expect(params[0]).toBe('%50\\% off%');
  });

  it('escapes _ in contains value', () => {
    const validated = validateFilterAst(LIKE_UNDERSCORE_VALUE);
    if (!validated.success) throw new Error('Validation failed');
    const { params } = compileToPredicate(validated.data, { clock });
    expect(params[0]).toBe('%user\\_name%');
  });
});

// ---------------------------------------------------------------------------
// EXISTS subqueries
// ---------------------------------------------------------------------------

describe('compileToPredicate — EXISTS subqueries', () => {
  it('tag_id eq compiles to EXISTS subquery', () => {
    const { sql, params } = compile(TAG_EXISTS);
    expect(sql).toContain('EXISTS');
    expect(sql).toContain('ticket_tags');
    expect(sql).toContain('ticket_id');
    expect(sql).not.toContain('JOIN');
    expect(params).toHaveLength(1);
  });

  it('tag_id in compiles to EXISTS ... IN', () => {
    const { sql, params } = compile(TAG_IN_ARRAY);
    expect(sql).toContain('EXISTS');
    expect(sql).toContain('IN ($1, $2)');
    expect(params).toHaveLength(2);
  });

  it('tag_id not_in compiles to NOT EXISTS', () => {
    const ast: FilterAst = {
      type: 'condition',
      field: 'tag_id',
      operator: 'not_in',
      value: ['00000000-0000-0000-0000-000000000002'],
    };
    const { sql } = compile(ast);
    expect(sql).toContain('NOT EXISTS');
  });

  it('affected_area compiles to EXISTS (separate table)', () => {
    const ast: FilterAst = {
      type: 'condition',
      field: 'affected_area',
      operator: 'eq',
      value: '00000000-0000-0000-0000-000000000004',
    };
    const { sql } = compile(ast);
    expect(sql).toContain('EXISTS');
    expect(sql).toContain('ticket_affected_areas');
  });
});

// ---------------------------------------------------------------------------
// Group nodes
// ---------------------------------------------------------------------------

describe('compileToPredicate — groups', () => {
  it('AND group wraps in parentheses with AND', () => {
    const { sql, params } = compile(AND_GROUP);
    expect(sql).toMatch(/\(.*AND.*/);
    expect(params).toHaveLength(2);
  });

  it('OR group wraps in parentheses with OR', () => {
    const { sql } = compile(OR_GROUP);
    expect(sql).toMatch(/\(.*OR.*/);
  });

  it('nested group produces nested parentheses', () => {
    const { sql } = compile(NESTED_GROUP);
    expect(sql.split('(').length).toBeGreaterThan(2);
  });

  it('empty AND group compiles to TRUE', () => {
    const { sql, params } = compile(EMPTY_AND_GROUP);
    expect(sql).toBe('TRUE');
    expect(params).toHaveLength(0);
  });

  it('empty OR group compiles to FALSE', () => {
    const ast: FilterAst = { type: 'group', op: 'or', children: [] };
    const { sql } = compile(ast);
    expect(sql).toBe('FALSE');
  });
});

// ---------------------------------------------------------------------------
// Relative date tokens
// ---------------------------------------------------------------------------

describe('compileToPredicate — relative dates', () => {
  it('last_7_days resolves to a Date 7 days before clock.now()', () => {
    const validated = validateFilterAst(RELATIVE_DATE);
    if (!validated.success) throw new Error('Validation failed');
    const { params } = compileToPredicate(validated.data, { clock });
    const resolved = params[0] as Date;
    expect(resolved).toBeInstanceOf(Date);
    const expectedMs = FIXED_NOW.getTime() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(resolved.getTime() - expectedMs)).toBeLessThan(1000);
  });

  it('relative date resolution is deterministic for the same clock', () => {
    const ast: FilterAst = { type: 'condition', field: 'created_at', operator: 'gte', value: 'last_30_days' };
    const v = validateFilterAst(ast);
    if (!v.success) throw new Error('Failed');
    const r1 = compileToPredicate(v.data, { clock });
    const r2 = compileToPredicate(v.data, { clock });
    expect((r1.params[0] as Date).getTime()).toBe((r2.params[0] as Date).getTime());
  });
});

// ---------------------------------------------------------------------------
// SECURITY: adversarial input — literals must appear in params only
// ---------------------------------------------------------------------------

describe('compileToPredicate — SECURITY: adversarial values never in sql string', () => {
  const INJECTIONS: Array<{ name: string; ast: FilterAst; literal: string }> = [
    { name: 'SQL injection (single quote + DROP)', ast: SQL_INJECTION_IN_VALUE, literal: "DROP TABLE" },
    { name: 'SQL injection (single quote)', ast: SQL_INJECTION_IN_VALUE, literal: "billing'" },
    { name: 'comment injection (/* */)', ast: COMMENT_INJECTION, literal: '/* hidden injection */' },
    { name: 'unicode quote', ast: UNICODE_INJECTION, literal: "val'ue" },
    { name: 'semicolon injection', ast: SEMICOLON_INJECTION, literal: '; SELECT' },
    { name: 'double-dash comment', ast: DOUBLE_DASH_INJECTION, literal: '-- comment' },
  ];

  for (const { name, ast, literal } of INJECTIONS) {
    it(`${name}: literal "${literal.slice(0, 20)}" does not appear in sql`, () => {
      const validated = validateFilterAst(ast);
      if (!validated.success) {
        // Some adversarial inputs may be rejected at validation — that's also acceptable
        return;
      }
      const { sql, params } = compileToPredicate(validated.data, { clock });
      assertLiteralNotInSql(sql, literal);
      // The raw value should appear in params (or a transformed version)
      expect(params.length).toBeGreaterThan(0);
      // sql should only contain $n placeholders and SQL keywords
      expect(sql).toMatch(/\$\d/);
    });
  }

  it('sql string contains no raw user-supplied UUID literals', () => {
    const uuid = '00000000-0000-0000-0000-deadbeef0001';
    const ast: FilterAst = { type: 'condition', field: 'organization_id', operator: 'eq', value: uuid };
    const { sql, params } = compile(ast);
    expect(sql).not.toContain(uuid);
    expect(params[0]).toBe(uuid);
  });

  it('sql string contains no raw enum values', () => {
    const { sql, params } = compile(SLA_STATE_IN);
    expect(sql).not.toContain('warning');
    expect(sql).not.toContain('breached');
    expect(params).toContain('warning');
    expect(params).toContain('breached');
  });
});

// ---------------------------------------------------------------------------
// Param offset accumulation
// ---------------------------------------------------------------------------

describe('compileToPredicate — param offset', () => {
  it('multiple conditions accumulate param offsets correctly', () => {
    const ast: FilterAst = {
      type: 'group',
      op: 'and',
      children: [
        { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
        { type: 'condition', field: 'priority', operator: 'eq', value: 'P1' },
        { type: 'condition', field: 'organization_id', operator: 'eq', value: '00000000-0000-0000-0000-000000000001' },
      ],
    };
    const { sql, params } = compile(ast);
    expect(params).toHaveLength(3);
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(sql).toContain('$3');
  });
});

// ---------------------------------------------------------------------------
// parseFilterAst integration
// ---------------------------------------------------------------------------

describe('parseFilterAst', () => {
  it('parses valid raw JSON and returns compiled-ready AST', () => {
    const raw = { type: 'condition', field: 'status', operator: 'eq', value: 'open' };
    const result = parseFilterAst(raw);
    expect(result.success).toBe(true);
  });

  it('rejects unknown field', () => {
    const result = parseFilterAst({ type: 'condition', field: 'injected', operator: 'eq', value: '1' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(e => e.code === 'UNKNOWN_FIELD')).toBe(true);
    }
  });

  it('rejects extra properties (z.strict)', () => {
    const result = parseFilterAst({
      type: 'condition', field: 'status', operator: 'eq', value: 'open',
      inject: '1; DROP TABLE tickets; --',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(e => e.code === 'INVALID_STRUCTURE')).toBe(true);
    }
  });
});
