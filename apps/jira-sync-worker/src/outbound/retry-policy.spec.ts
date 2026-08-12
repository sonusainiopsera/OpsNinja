/**
 * retry-policy.spec.ts — unit tests for outbound Jira backoff schedule (WO-056 AC9).
 *
 * Pure-function tests — no I/O, no mocking required.
 * Covers: backoff sequence, Retry-After override, jitter bounds, final-attempt detection.
 */

import {
  getRetryDecision,
  withJitter,
  MAX_ATTEMPTS,
  BACKOFF_SECONDS,
} from './retry-policy';

describe('RetryPolicy — backoff schedule', () => {
  it('MAX_ATTEMPTS is 6', () => {
    expect(MAX_ATTEMPTS).toBe(6);
  });

  it('BACKOFF_SECONDS has exactly 6 entries matching documented schedule', () => {
    expect(BACKOFF_SECONDS).toHaveLength(6);
    expect(BACKOFF_SECONDS).toEqual([1, 2, 4, 8, 60, 900]);
  });

  it('attempt 0 → shouldRetry=true, delaySeconds=1, isFinalAttempt=false', () => {
    const d = getRetryDecision(0);
    expect(d.shouldRetry).toBe(true);
    expect(d.delaySeconds).toBe(1);
    expect(d.isFinalAttempt).toBe(false);
  });

  it('attempt 1 → delaySeconds=2', () => {
    expect(getRetryDecision(1).delaySeconds).toBe(2);
  });

  it('attempt 2 → delaySeconds=4', () => {
    expect(getRetryDecision(2).delaySeconds).toBe(4);
  });

  it('attempt 3 → delaySeconds=8', () => {
    expect(getRetryDecision(3).delaySeconds).toBe(8);
  });

  it('attempt 4 → delaySeconds=60', () => {
    expect(getRetryDecision(4).delaySeconds).toBe(60);
  });

  it('attempt 5 (final) → shouldRetry=false, isFinalAttempt=true', () => {
    const d = getRetryDecision(5);
    expect(d.shouldRetry).toBe(false);
    expect(d.isFinalAttempt).toBe(true);
    expect(d.delaySeconds).toBe(0);
  });

  it('attempt beyond MAX → shouldRetry=false (dead-letter)', () => {
    expect(getRetryDecision(10).shouldRetry).toBe(false);
  });
});

describe('RetryPolicy — Retry-After override', () => {
  it('uses Retry-After when it exceeds scheduled delay', () => {
    // attempt 0 scheduled=1s; Retry-After=30s → uses 30
    const d = getRetryDecision(0, 30);
    expect(d.delaySeconds).toBe(30);
    expect(d.shouldRetry).toBe(true);
  });

  it('keeps scheduled delay when Retry-After is smaller', () => {
    // attempt 3 scheduled=8s; Retry-After=2s → keeps 8
    const d = getRetryDecision(3, 2);
    expect(d.delaySeconds).toBe(8);
  });

  it('ignores Retry-After=0 (uses scheduled delay)', () => {
    const d = getRetryDecision(2, 0);
    expect(d.delaySeconds).toBe(4);
  });

  it('Retry-After on final attempt still returns shouldRetry=false', () => {
    const d = getRetryDecision(5, 120);
    expect(d.shouldRetry).toBe(false);
  });
});

describe('RetryPolicy — withJitter', () => {
  it('result is always at least 1 second', () => {
    for (let i = 0; i < 50; i++) {
      expect(withJitter(1)).toBeGreaterThanOrEqual(1);
    }
  });

  it('stays within ±50% of base value (with rounding allowance)', () => {
    const base = 60;
    for (let i = 0; i < 50; i++) {
      const result = withJitter(base);
      expect(result).toBeGreaterThanOrEqual(base * 0.5);
      expect(result).toBeLessThanOrEqual(base * 1.5 + 1);
    }
  });

  it('returns a whole number (Math.round applied)', () => {
    for (let i = 0; i < 20; i++) {
      expect(Number.isInteger(withJitter(10))).toBe(true);
    }
  });
});
