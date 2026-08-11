import { SeededPrng } from '../prng';

describe('SeededPrng', () => {
  it('produces values in [0, 1)', () => {
    const prng = new SeededPrng(42);
    for (let i = 0; i < 1000; i++) {
      const v = prng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('same seed produces identical sequence', () => {
    const a = new SeededPrng(12345);
    const b = new SeededPrng(12345);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds produce different sequences', () => {
    const a = new SeededPrng(1);
    const b = new SeededPrng(2);
    const aVals = Array.from({ length: 20 }, () => a.next());
    const bVals = Array.from({ length: 20 }, () => b.next());
    expect(aVals).not.toEqual(bVals);
  });

  it('int() returns values within [min, max)', () => {
    const prng = new SeededPrng(99);
    for (let i = 0; i < 500; i++) {
      const v = prng.int(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });

  it('pick() returns an element from the array', () => {
    const prng = new SeededPrng(7);
    const arr = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(prng.pick(arr));
    }
  });

  it('uuid() returns v4-shaped strings', () => {
    const prng = new SeededPrng(42);
    const id = prng.uuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('uuid() deterministic across runs with same seed', () => {
    const a = new SeededPrng(42);
    const b = new SeededPrng(42);
    expect(a.uuid()).toBe(b.uuid());
  });

  it('shuffle() produces a permutation of the input', () => {
    const prng = new SeededPrng(1);
    const arr = [1, 2, 3, 4, 5];
    const shuffled = prng.shuffle([...arr]);
    expect(shuffled.sort()).toEqual(arr);
  });
});
