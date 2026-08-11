/**
 * ast.test.ts — structural AST validation and limit enforcement.
 */

import { describe, it, expect } from 'vitest';

import { parseFilterAst, validateFilterAst } from '../src/validate';
import { countNodes, maxDepth, MAX_DEPTH, MAX_NODES } from '../src/ast';
import {
  UNKNOWN_FIELD_AST,
  UNKNOWN_OPERATOR_AST,
  WRONG_OPERATOR_AST,
  EMPTY_IN_ARRAY_AST,
  EXTRA_PROPERTY_AST,
  DEPTH_EXCEEDED_AST,
  INVALID_UUID,
  INVALID_STATUS_ENUM,
  INVALID_DATE,
} from './fixtures/filters';

// ---------------------------------------------------------------------------
// Structural parsing
// ---------------------------------------------------------------------------

describe('parseFilterAst — structural validation', () => {
  it('accepts a valid condition node', () => {
    const r = parseFilterAst({ type: 'condition', field: 'status', operator: 'eq', value: 'open' });
    expect(r.success).toBe(true);
  });

  it('accepts a valid group node', () => {
    const r = parseFilterAst({
      type: 'group',
      op: 'and',
      children: [{ type: 'condition', field: 'status', operator: 'eq', value: 'open' }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown type', () => {
    const r = parseFilterAst({ type: 'unknown', field: 'status' });
    expect(r.success).toBe(false);
  });

  it('rejects missing required field', () => {
    const r = parseFilterAst({ type: 'condition', operator: 'eq', value: 'open' });
    expect(r.success).toBe(false);
  });

  it('rejects extra properties (strict)', () => {
    const r = parseFilterAst(EXTRA_PROPERTY_AST);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some(e => e.code === 'INVALID_STRUCTURE')).toBe(true);
    }
  });

  it('rejects group with invalid op', () => {
    const r = parseFilterAst({ type: 'group', op: 'xor', children: [] });
    expect(r.success).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(parseFilterAst('string').success).toBe(false);
    expect(parseFilterAst(null).success).toBe(false);
    expect(parseFilterAst(42).success).toBe(false);
    expect(parseFilterAst([]).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Semantic validation
// ---------------------------------------------------------------------------

describe('validateFilterAst — semantic validation', () => {
  it('rejects unknown field', () => {
    const r = parseFilterAst(UNKNOWN_FIELD_AST);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some(e => e.code === 'UNKNOWN_FIELD')).toBe(true);
    }
  });

  it('rejects unknown operator', () => {
    const r = parseFilterAst(UNKNOWN_OPERATOR_AST);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some(e => e.code === 'OPERATOR_NOT_ALLOWED')).toBe(true);
    }
  });

  it('rejects operator not allowed on field', () => {
    const r = parseFilterAst(WRONG_OPERATOR_AST);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some(e => e.code === 'OPERATOR_NOT_ALLOWED')).toBe(true);
    }
  });

  it('rejects empty IN array', () => {
    const r = parseFilterAst(EMPTY_IN_ARRAY_AST);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some(e => e.code === 'EMPTY_IN_ARRAY')).toBe(true);
    }
  });

  it('rejects invalid UUID value', () => {
    const r = parseFilterAst(INVALID_UUID);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some(e => e.code === 'INVALID_VALUE')).toBe(true);
    }
  });

  it('rejects invalid status enum', () => {
    const r = parseFilterAst(INVALID_STATUS_ENUM);
    expect(r.success).toBe(false);
  });

  it('rejects invalid date string', () => {
    const r = parseFilterAst(INVALID_DATE);
    expect(r.success).toBe(false);
  });

  it('reports all errors from nested group', () => {
    const r = parseFilterAst({
      type: 'group',
      op: 'and',
      children: [
        { type: 'condition', field: 'unknown_field_1', operator: 'eq', value: '1' },
        { type: 'condition', field: 'unknown_field_2', operator: 'eq', value: '2' },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const unknownErrors = r.errors.filter(e => e.code === 'UNKNOWN_FIELD');
      expect(unknownErrors.length).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Depth and node count limits
// ---------------------------------------------------------------------------

describe('validateFilterAst — limits', () => {
  it(`rejects AST exceeding MAX_DEPTH (${MAX_DEPTH})`, () => {
    const r = parseFilterAst(DEPTH_EXCEEDED_AST);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some(e => e.code === 'DEPTH_EXCEEDED')).toBe(true);
    }
  });

  it(`rejects AST exceeding MAX_NODES (${MAX_NODES})`, () => {
    // Build a flat group with 51 condition nodes
    const children = Array.from({ length: MAX_NODES + 1 }, () => ({
      type: 'condition' as const,
      field: 'status',
      operator: 'eq',
      value: 'open',
    }));
    const r = parseFilterAst({ type: 'group', op: 'and', children });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some(e => e.code === 'NODE_COUNT_EXCEEDED')).toBe(true);
    }
  });

  it(`accepts AST at exactly MAX_DEPTH (${MAX_DEPTH})`, () => {
    // 4 levels of nesting = depth 4 (groups at 0,1,2,3 then condition at depth 4)
    let inner: object = { type: 'condition', field: 'status', operator: 'eq', value: 'open' };
    for (let i = 0; i < MAX_DEPTH; i++) {
      inner = { type: 'group', op: 'and', children: [inner] };
    }
    const r = parseFilterAst(inner);
    expect(r.success).toBe(true);
  });

  it(`accepts ${MAX_NODES} condition nodes (exactly at limit)`, () => {
    const children = Array.from({ length: MAX_NODES }, () => ({
      type: 'condition' as const,
      field: 'status',
      operator: 'eq',
      value: 'open',
    }));
    const r = parseFilterAst({ type: 'group', op: 'and', children });
    // Note: Zod's max(50) on children array + countNodes check — should pass
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// countNodes / maxDepth utilities
// ---------------------------------------------------------------------------

describe('countNodes', () => {
  it('single condition = 1', () => {
    expect(countNodes({ type: 'condition', field: 'status', operator: 'eq', value: 'open' })).toBe(1);
  });

  it('group with 3 conditions = 3', () => {
    const ast = {
      type: 'group' as const,
      op: 'and' as const,
      children: [
        { type: 'condition' as const, field: 'status', operator: 'eq', value: 'open' },
        { type: 'condition' as const, field: 'priority', operator: 'eq', value: 'P1' },
        { type: 'condition' as const, field: 'organization_id', operator: 'eq', value: '00000000-0000-0000-0000-000000000001' },
      ],
    };
    expect(countNodes(ast)).toBe(3);
  });

  it('empty group = 0', () => {
    expect(countNodes({ type: 'group', op: 'and', children: [] })).toBe(0);
  });
});

describe('maxDepth', () => {
  it('single condition = depth 0', () => {
    expect(maxDepth({ type: 'condition', field: 'status', operator: 'eq', value: 'open' })).toBe(0);
  });

  it('one group wrapping condition = depth 1', () => {
    const ast = {
      type: 'group' as const,
      op: 'and' as const,
      children: [{ type: 'condition' as const, field: 'status', operator: 'eq', value: 'open' }],
    };
    expect(maxDepth(ast)).toBe(1);
  });
});
