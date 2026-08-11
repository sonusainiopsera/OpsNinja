import { describe, it, expect } from 'vitest';
import {
  FilterAstSchema,
  countConditions,
  getDepth,
  MAX_DEPTH,
  MAX_CONDITIONS,
} from '../src/ast';
import {
  simpleEqStatus,
  nestedGroupFilter,
  groupAndFilter,
  extraPropsRaw,
  buildDeepAst,
  buildWideAst,
} from './fixtures/filters';

describe('FilterAstSchema', () => {
  it('parses a simple condition node', () => {
    const r = FilterAstSchema.safeParse(simpleEqStatus);
    expect(r.success).toBe(true);
  });

  it('parses a nested group node', () => {
    const r = FilterAstSchema.safeParse(nestedGroupFilter);
    expect(r.success).toBe(true);
  });

  it('rejects a node missing type', () => {
    const r = FilterAstSchema.safeParse({ field: 'status', operator: 'eq', value: 'open' });
    expect(r.success).toBe(false);
  });

  it('rejects extra properties on condition node (.strict())', () => {
    const r = FilterAstSchema.safeParse(extraPropsRaw);
    expect(r.success).toBe(false);
  });

  it('rejects extra properties on group node (.strict())', () => {
    const r = FilterAstSchema.safeParse({
      type: 'group',
      op: 'and',
      children: [],
      injected: 'DROP',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown op value on group', () => {
    const r = FilterAstSchema.safeParse({ type: 'group', op: 'xor', children: [] });
    expect(r.success).toBe(false);
  });

  it('parses a group with empty children', () => {
    const r = FilterAstSchema.safeParse({ type: 'group', op: 'and', children: [] });
    expect(r.success).toBe(true);
  });
});

describe('countConditions', () => {
  it('returns 1 for a bare condition node', () => {
    expect(countConditions(simpleEqStatus)).toBe(1);
  });

  it('returns correct count for group', () => {
    expect(countConditions(groupAndFilter)).toBe(2);
  });

  it('returns correct count for nested groups', () => {
    expect(countConditions(nestedGroupFilter)).toBe(3);
  });

  it('returns 0 for empty group', () => {
    expect(countConditions({ type: 'group', op: 'and', children: [] })).toBe(0);
  });
});

describe('getDepth', () => {
  it('returns 0 for a bare condition node', () => {
    expect(getDepth(simpleEqStatus)).toBe(0);
  });

  it('returns 1 for a single-level group', () => {
    expect(getDepth(groupAndFilter)).toBe(1);
  });

  it('returns 2 for a two-level nested group', () => {
    expect(getDepth(nestedGroupFilter)).toBe(2);
  });

  it('returns 0 for empty group', () => {
    expect(getDepth({ type: 'group', op: 'and', children: [] })).toBe(0);
  });

  it('respects MAX_DEPTH constant', () => {
    const deep = buildDeepAst(MAX_DEPTH) as Parameters<typeof getDepth>[0];
    const r = FilterAstSchema.safeParse(deep);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(getDepth(r.data)).toBe(MAX_DEPTH);
    }
  });
});
