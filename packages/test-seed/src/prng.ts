/**
 * SeededPrng – Mulberry32 deterministic pseudo-random number generator.
 *
 * All factory modules receive an instance of this class instead of calling
 * Math.random() directly. This structural constraint (enforced by the ESLint
 * no-restricted-syntax rule in .eslintrc.cjs) guarantees that seeding the
 * generator with the same integer always produces an identical sequence of
 * values — required for the CI determinism assertion.
 *
 * Algorithm: Mulberry32 (32-bit, period ~2^32).
 * Reference: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 */
export class SeededPrng {
  private state: number;

  constructor(seed: number) {
    // Ensure seed is a 32-bit unsigned integer.
    this.state = seed >>> 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    z = (z ^ (z >>> 14)) >>> 0;
    return z / 0x100000000;
  }

  /** Returns an integer in [min, max). */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /** Picks one element from an array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length)];
  }

  /** Returns a boolean with the given probability (0–1). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Shuffles an array in place (Fisher-Yates) using the seeded PRNG. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Generates a deterministic UUID-shaped string from the current PRNG state. */
  uuid(): string {
    const hex = (n: number) => n.toString(16).padStart(8, '0');
    const a = (this.next() * 0x100000000) >>> 0;
    const b = (this.next() * 0x100000000) >>> 0;
    const c = (this.next() * 0x100000000) >>> 0;
    const d = (this.next() * 0x100000000) >>> 0;
    const s = hex(a) + hex(b) + hex(c) + hex(d);
    return [
      s.slice(0, 8),
      s.slice(8, 12),
      '4' + s.slice(13, 16),
      ((parseInt(s[16], 16) & 0x3) | 0x8).toString(16) + s.slice(17, 20),
      s.slice(20, 32),
    ].join('-');
  }
}
