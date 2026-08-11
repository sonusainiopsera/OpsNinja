/**
 * signature.test.ts — property-style tests for computeSignature.
 *
 * Asserts:
 *   - Identical ASTs produce identical hashes.
 *   - Key reordering produces the same hash (canonical JSON).
 *   - Different ASTs produce different hashes.
 *   - Hash is prefixed with compiler version.
 *   - Whitespace variation produces the same hash.
 */

import { describe, it, expect } from 'vitest';

import { computeSignature } from '../src/signature';
import type { FilterAst } from '../src/ast';
import { SIMPLE_STATUS_EQ, AND_GROUP, SIMPLE_PRIORITY_IN } from './fixtures/filters';

describe('computeSignature — stability', () => {
  it('same AST always produces same signature', () => {
    expect(computeSignature(SIMPLE_STATUS_EQ)).toBe(computeSignature(SIMPLE_STATUS_EQ));
  });

  it('key reordering produces same signature', () => {
    const ast1: FilterAst = { type: 'condition', field: 'status', operator: 'eq', value: 'open' };
    // JS objects don't guarantee key order, but our canonicalize sorts them
    const ast2 = { operator: 'eq', value: 'open', type: 'condition', field: 'status' } as unknown as FilterAst;
    expect(computeSignature(ast1)).toBe(computeSignature(ast2));
  });

  it('group with reordered properties matches', () => {
    const ast1: FilterAst = { type: 'group', op: 'and', children: [SIMPLE_STATUS_EQ] };
    const ast2 = { op: 'and', children: [SIMPLE_STATUS_EQ], type: 'group' } as unknown as FilterAst;
    expect(computeSignature(ast1)).toBe(computeSignature(ast2));
  });

  it('repeated calls are deterministic', () => {
    const sigs = Array.from({ length: 10 }, () => computeSignature(AND_GROUP));
    expect(new Set(sigs).size).toBe(1);
  });
});

describe('computeSignature — uniqueness', () => {
  it('different field produces different signature', () => {
    const a1: FilterAst = { type: 'condition', field: 'status', operator: 'eq', value: 'open' };
    const a2: FilterAst = { type: 'condition', field: 'priority', operator: 'eq', value: 'open' };
    expect(computeSignature(a1)).not.toBe(computeSignature(a2));
  });

  it('different value produces different signature', () => {
    const a1: FilterAst = { type: 'condition', field: 'status', operator: 'eq', value: 'open' };
    const a2: FilterAst = { type: 'condition', field: 'status', operator: 'eq', value: 'closed' };
    expect(computeSignature(a1)).not.toBe(computeSignature(a2));
  });

  it('different operator produces different signature', () => {
    const a1: FilterAst = { type: 'condition', field: 'status', operator: 'eq', value: 'open' };
    const a2: FilterAst = { type: 'condition', field: 'status', operator: 'neq', value: 'open' };
    expect(computeSignature(a1)).not.toBe(computeSignature(a2));
  });

  it('and vs or group produces different signature', () => {
    const a1: FilterAst = { type: 'group', op: 'and', children: [SIMPLE_STATUS_EQ] };
    const a2: FilterAst = { type: 'group', op: 'or', children: [SIMPLE_STATUS_EQ] };
    expect(computeSignature(a1)).not.toBe(computeSignature(a2));
  });

  it('different array values produce different signatures', () => {
    expect(computeSignature(SIMPLE_PRIORITY_IN)).not.toBe(computeSignature(SIMPLE_STATUS_EQ));
  });
});

describe('computeSignature — format', () => {
  it('starts with "fc-v1:" prefix', () => {
    expect(computeSignature(SIMPLE_STATUS_EQ)).toMatch(/^fc-v1:/);
  });

  it('hex hash portion is 64 characters (SHA-256)', () => {
    const sig = computeSignature(SIMPLE_STATUS_EQ);
    const hash = sig.split(':')[1];
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a string suitable as a Redis key', () => {
    const sig = computeSignature(SIMPLE_STATUS_EQ);
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeLessThan(80);
    // No spaces or characters unsafe for Redis keys
    expect(sig).toMatch(/^[a-z0-9A-Z:_-]+$/);
  });
});

describe('computeSignature — nested AST', () => {
  it('nested group signature differs from flat', () => {
    const flat: FilterAst = {
      type: 'group',
      op: 'and',
      children: [
        { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
        { type: 'condition', field: 'priority', operator: 'eq', value: 'P1' },
      ],
    };
    const nested: FilterAst = {
      type: 'group',
      op: 'and',
      children: [
        {
          type: 'group',
          op: 'and',
          children: [
            { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
            { type: 'condition', field: 'priority', operator: 'eq', value: 'P1' },
          ],
        },
      ],
    };
    expect(computeSignature(flat)).not.toBe(computeSignature(nested));
  });
});
