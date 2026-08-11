import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../src/prng';

describe('SeededRandom', () => {
  it('produces deterministic values for the same seed', () => {
    const r1 = new SeededRandom(42);
    const r2 = new SeededRandom(42);
    const seq1 = Array.from({ length: 20 }, () => r1.next());
    const seq2 = Array.from({ length: 20 }, () => r2.next());
    expect(seq1).toEqual(seq2);
  });

  it('produces different values for different seeds', () => {
    const r1 = new SeededRandom(42);
    const r2 = new SeededRandom(43);
    const v1 = r1.next();
    const v2 = r2.next();
    expect(v1).not.toBe(v2);
  });

  it('returns floats in [0, 1)', () => {
    const r = new SeededRandom(99);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt returns integers in [0, max)', () => {
    const r = new SeededRandom(1);
    for (let i = 0; i < 500; i++) {
      const v = r.nextInt(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('nextIntRange returns integers in [min, max]', () => {
    const r = new SeededRandom(7);
    for (let i = 0; i < 500; i++) {
      const v = r.nextIntRange(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it('uuid produces valid UUID-shaped strings', () => {
    const r = new SeededRandom(42);
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let i = 0; i < 20; i++) {
      expect(r.uuid()).toMatch(UUID_RE);
    }
  });

  it('child PRNG is deterministic', () => {
    const r1 = new SeededRandom(42);
    const r2 = new SeededRandom(42);
    const c1 = r1.child(5);
    const c2 = r2.child(5);
    expect(c1.next()).toBe(c2.next());
  });

  it('pick returns array members', () => {
    const r = new SeededRandom(10);
    const arr = ['a', 'b', 'c', 'd'] as const;
    for (let i = 0; i < 50; i++) {
      expect(arr).toContain(r.pick(arr));
    }
  });

  it('sample returns the correct number of elements', () => {
    const r = new SeededRandom(3);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = r.sample(arr, 4);
    expect(result).toHaveLength(4);
    // No duplicates
    expect(new Set(result).size).toBe(4);
  });
});
