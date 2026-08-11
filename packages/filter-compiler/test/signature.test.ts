import { describe, it, expect } from 'vitest';
import { computeSignature, COMPILER_VERSION } from '../src/signature';
import type { FilterAst } from '../src/ast';

const ast1: FilterAst = {
  type: 'group',
  op: 'and',
  children: [
    { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
    { type: 'condition', field: 'priority', operator: 'in', value: ['p1', 'p2'] },
  ],
};

// Same as ast1 but object keys in a different order
const ast1ReorderedKeys = {
  children: [
    { value: 'open', operator: 'eq', field: 'status', type: 'condition' as const },
    { value: ['p1', 'p2'], operator: 'in', field: 'priority', type: 'condition' as const },
  ],
  op: 'and' as const,
  type: 'group' as const,
};

const ast2: FilterAst = {
  type: 'condition',
  field: 'status',
  operator: 'eq',
  value: 'closed',
};

describe('computeSignature', () => {
  it('produces a string prefixed with fc:v{version}:', () => {
    const sig = computeSignature(ast1);
    expect(sig).toMatch(new RegExp(`^fc:v${COMPILER_VERSION}:`));
  });

  it('is stable: same AST produces the same signature', () => {
    expect(computeSignature(ast1)).toBe(computeSignature(ast1));
  });

  it('is key-order independent: same content, different key order → same signature', () => {
    const sig1 = computeSignature(ast1);
    const sig2 = computeSignature(ast1ReorderedKeys as FilterAst);
    expect(sig1).toBe(sig2);
  });

  it('different ASTs produce different signatures', () => {
    expect(computeSignature(ast1)).not.toBe(computeSignature(ast2));
  });

  it('returns a 64-char hex string after the prefix', () => {
    const sig = computeSignature(ast1);
    const hex = sig.replace(`fc:v${COMPILER_VERSION}:`, '');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signature is stable across repeated calls on different object instances', () => {
    const a = JSON.parse(JSON.stringify(ast1)) as FilterAst;
    const b = JSON.parse(JSON.stringify(ast1)) as FilterAst;
    expect(computeSignature(a)).toBe(computeSignature(b));
  });

  it('value whitespace differences produce different signatures', () => {
    const a: FilterAst = { type: 'condition', field: 'category_path', operator: 'contains', value: 'foo' };
    const b: FilterAst = { type: 'condition', field: 'category_path', operator: 'contains', value: ' foo ' };
    expect(computeSignature(a)).not.toBe(computeSignature(b));
  });

  it('array element order matters for signature', () => {
    const a: FilterAst = { type: 'condition', field: 'priority', operator: 'in', value: ['p1', 'p2'] };
    const b: FilterAst = { type: 'condition', field: 'priority', operator: 'in', value: ['p2', 'p1'] };
    // Different order → different canonical form → different signature
    expect(computeSignature(a)).not.toBe(computeSignature(b));
  });

  it('produces a valid Redis key (no whitespace or special chars)', () => {
    const sig = computeSignature(ast1);
    expect(sig).toMatch(/^[a-zA-Z0-9:]+$/);
  });
});
