/**
 * Seeded deterministic PRNG — Mulberry32 algorithm.
 *
 * NEVER use Math.random() in this package. All random values must flow through
 * this class so that any dataset can be reproduced byte-for-byte from the seed.
 *
 * The ESLint config for this package bans Math.random via no-restricted-syntax.
 */

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /**
   * Returns a float in [0, 1).
   * Mulberry32: fast, good statistical properties, 32-bit state.
   */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  }

  /** Returns an integer in [0, max). */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** Returns an integer in [min, max]. */
  nextIntRange(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Returns true with the given probability [0, 1]. */
  nextBool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  /** Returns a random element from an array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.nextInt(arr.length)]!;
  }

  /** Returns n random elements from an array (without replacement). */
  sample<T>(arr: readonly T[], n: number): T[] {
    const copy = [...arr];
    const result: T[] = [];
    for (let i = 0; i < Math.min(n, copy.length); i++) {
      const idx = this.nextInt(copy.length - i);
      result.push(copy[idx]!);
      // Swap with end for O(n) Fisher-Yates
      [copy[idx], copy[copy.length - i - 1]] = [copy[copy.length - i - 1]!, copy[idx]!];
    }
    return result;
  }

  /** Returns a shuffled copy of the array. */
  shuffle<T>(arr: readonly T[]): T[] {
    return this.sample(arr, arr.length);
  }

  /**
   * Derives a child PRNG from this one with a deterministic sub-seed.
   * Use to create per-tenant or per-table PRNGs without mixing state.
   */
  child(offset: number): SeededRandom {
    return new SeededRandom((this.state ^ offset) >>> 0);
  }

  /** Returns a UUID-v4-shaped string using this PRNG (not cryptographically random). */
  uuid(): string {
    const hex = (n: number): string => n.toString(16).padStart(2, '0');
    const b = Array.from({ length: 16 }, () => this.nextInt(256));
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    return [
      [b[0], b[1], b[2], b[3]].map(hex).join(''),
      [b[4], b[5]].map(hex).join(''),
      [b[6], b[7]].map(hex).join(''),
      [b[8], b[9]].map(hex).join(''),
      [b[10], b[11], b[12], b[13], b[14], b[15]].map(hex).join(''),
    ].join('-');
  }
}
