import { describe, it, expect } from 'vitest';
import {
  nextAttemptAt,
  shouldDeadLetter,
  backoffMs,
  BACKOFF_SECONDS,
  MAX_ATTEMPTS,
} from '../backoff.js';

describe('nextAttemptAt', () => {
  const fixedNow = new Date('2025-06-01T12:00:00.000Z');

  it('schedules 1s delay for first failure (attempts=0)', () => {
    const next = nextAttemptAt(0, fixedNow);
    expect(next.getTime() - fixedNow.getTime()).toBe(1_000);
  });

  it('schedules 2s delay for second failure (attempts=1)', () => {
    const next = nextAttemptAt(1, fixedNow);
    expect(next.getTime() - fixedNow.getTime()).toBe(2_000);
  });

  it('schedules 4s delay for third failure (attempts=2)', () => {
    const next = nextAttemptAt(2, fixedNow);
    expect(next.getTime() - fixedNow.getTime()).toBe(4_000);
  });

  it('schedules 8s delay for fourth failure (attempts=3)', () => {
    const next = nextAttemptAt(3, fixedNow);
    expect(next.getTime() - fixedNow.getTime()).toBe(8_000);
  });

  it('schedules 60s delay for fifth failure (attempts=4)', () => {
    const next = nextAttemptAt(4, fixedNow);
    expect(next.getTime() - fixedNow.getTime()).toBe(60_000);
  });

  it('schedules 900s delay for sixth failure (attempts=5)', () => {
    const next = nextAttemptAt(5, fixedNow);
    expect(next.getTime() - fixedNow.getTime()).toBe(900_000);
  });

  it('clamps to 900s for attempts beyond the ladder (attempts=100)', () => {
    const next = nextAttemptAt(100, fixedNow);
    expect(next.getTime() - fixedNow.getTime()).toBe(900_000);
  });

  it('defaults to current time when now is not provided', () => {
    const before = Date.now();
    const next = nextAttemptAt(0);
    const after = Date.now();
    expect(next.getTime()).toBeGreaterThanOrEqual(before + 1_000);
    expect(next.getTime()).toBeLessThanOrEqual(after + 1_000 + 10); // 10ms tolerance
  });
});

describe('shouldDeadLetter', () => {
  it('returns false for attempts < MAX_ATTEMPTS', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(shouldDeadLetter(i)).toBe(false);
    }
  });

  it('returns true for attempts == MAX_ATTEMPTS', () => {
    expect(shouldDeadLetter(MAX_ATTEMPTS)).toBe(true);
  });

  it('returns true for attempts > MAX_ATTEMPTS', () => {
    expect(shouldDeadLetter(MAX_ATTEMPTS + 10)).toBe(true);
  });
});

describe('backoffMs', () => {
  it('matches the ladder entries in milliseconds', () => {
    BACKOFF_SECONDS.forEach((s, i) => {
      expect(backoffMs(i)).toBe(s * 1_000);
    });
  });

  it('clamps to last entry for out-of-range index', () => {
    const lastSec = BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1] ?? 900;
    expect(backoffMs(99)).toBe(lastSec * 1_000);
  });
});

describe('BACKOFF_SECONDS ladder shape', () => {
  it('has exactly MAX_ATTEMPTS entries', () => {
    expect(BACKOFF_SECONDS).toHaveLength(MAX_ATTEMPTS);
  });

  it('is monotonically increasing', () => {
    for (let i = 1; i < BACKOFF_SECONDS.length; i++) {
      const prev = BACKOFF_SECONDS[i - 1];
      const curr = BACKOFF_SECONDS[i];
      if (prev !== undefined && curr !== undefined) {
        expect(curr).toBeGreaterThan(prev);
      }
    }
  });
});
