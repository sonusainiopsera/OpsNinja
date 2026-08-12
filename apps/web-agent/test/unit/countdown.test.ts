/**
 * Countdown interpolation unit tests — WO-041, AC4 + AC9.
 *
 * Tests the pure SLA countdown math functions in
 * features/dashboard/state/countdown.ts:
 *
 *   computeCountdown  — interpolates remaining ms from server snapshot
 *   classifyDisplayState — maps (remainingMs, timerState, threshold) → display state
 *   formatRemainingMs    — long format: "1d 2h 3m 4s"
 *   formatRemainingShort — two-part short format for panel display
 *
 * No React, browser globals, or network calls. Uses fake clock via nowMs param.
 */

import { describe, it, expect } from 'vitest';
import {
  computeCountdown,
  classifyDisplayState,
  formatRemainingMs,
  formatRemainingShort,
} from '../../features/dashboard/state/countdown';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GENERATED_AT = '2026-08-11T10:00:00.000Z';
const GENERATED_AT_MS = new Date(GENERATED_AT).getTime();

// ---------------------------------------------------------------------------
// computeCountdown
// ---------------------------------------------------------------------------

describe('computeCountdown — running state', () => {
  it('returns remaining = remainingMs - elapsed when timerState is running', () => {
    const input = {
      remainingMs: 60_000,
      pausedMs: 0,
      generatedAt: GENERATED_AT,
      timerState: 'running',
    };
    // 5 seconds have elapsed
    const nowMs = GENERATED_AT_MS + 5_000;
    const result = computeCountdown(input, nowMs);

    expect(result.remainingMs).toBe(55_000);
    expect(result.breached).toBe(false);
    expect(result.displayState).toBe('running');
  });

  it('clamps remaining to 0 when elapsed > remainingMs (breach imminent)', () => {
    const input = {
      remainingMs: 3_000,
      pausedMs: 0,
      generatedAt: GENERATED_AT,
      timerState: 'running',
    };
    // 10 seconds elapsed — past the remaining 3s
    const nowMs = GENERATED_AT_MS + 10_000;
    const result = computeCountdown(input, nowMs);

    expect(result.remainingMs).toBe(0);
    expect(result.breached).toBe(true);
    expect(result.displayState).toBe('breached');
  });

  it('label is non-empty for running state', () => {
    const input = {
      remainingMs: 2 * 60 * 60 * 1000, // 2h
      pausedMs: 0,
      generatedAt: GENERATED_AT,
      timerState: 'running',
    };
    const result = computeCountdown(input, GENERATED_AT_MS);

    expect(result.label.length).toBeGreaterThan(0);
    expect(result.breached).toBe(false);
  });

  it('secondsLabel is zero-padded for running state', () => {
    const input = {
      remainingMs: 65_000, // 1m 5s
      pausedMs: 0,
      generatedAt: GENERATED_AT,
      timerState: 'running',
    };
    const result = computeCountdown(input, GENERATED_AT_MS);

    expect(result.secondsLabel).toBe('05');
  });

  it('secondsLabel is empty string for non-running state', () => {
    const input = {
      remainingMs: 60_000,
      pausedMs: 0,
      generatedAt: GENERATED_AT,
      timerState: 'paused',
    };
    const result = computeCountdown(input, GENERATED_AT_MS);

    expect(result.secondsLabel).toBe('');
  });
});

describe('computeCountdown — paused state', () => {
  it('freezes countdown when timerState is paused', () => {
    const input = {
      remainingMs: 30_000,
      pausedMs: 5_000,
      generatedAt: GENERATED_AT,
      timerState: 'paused',
    };
    // Even with 100s elapsed the result should freeze at remainingMs
    const nowMs = GENERATED_AT_MS + 100_000;
    const result = computeCountdown(input, nowMs);

    expect(result.remainingMs).toBe(30_000);
    expect(result.breached).toBe(false);
    expect(result.displayState).toBe('paused');
  });

  it('paused label includes the time remaining', () => {
    const input = {
      remainingMs: 90_000, // 1m 30s
      pausedMs: 0,
      generatedAt: GENERATED_AT,
      timerState: 'paused',
    };
    const result = computeCountdown(input, GENERATED_AT_MS);

    expect(result.label).toMatch(/paused/i);
    expect(result.breached).toBe(false);
  });
});

describe('computeCountdown — breached state', () => {
  it('returns breached immediately when timerState is breached', () => {
    const input = {
      remainingMs: 60_000,
      pausedMs: 0,
      generatedAt: GENERATED_AT,
      timerState: 'breached',
    };
    const result = computeCountdown(input, GENERATED_AT_MS);

    expect(result.remainingMs).toBe(0);
    expect(result.breached).toBe(true);
    expect(result.displayState).toBe('breached');
    expect(result.label).toBe('Breached');
  });

  it('returns breached when remainingMs is negative at snapshot time', () => {
    const input = {
      remainingMs: -5_000,
      pausedMs: 0,
      generatedAt: GENERATED_AT,
      timerState: 'running',
    };
    const result = computeCountdown(input, GENERATED_AT_MS);

    expect(result.breached).toBe(true);
    expect(result.remainingMs).toBe(0);
  });

  it('never returns negative remainingMs', () => {
    const input = {
      remainingMs: 1_000,
      pausedMs: 0,
      generatedAt: GENERATED_AT,
      timerState: 'running',
    };
    // 1 hour elapsed — well past the 1s remaining
    const nowMs = GENERATED_AT_MS + 3_600_000;
    const result = computeCountdown(input, nowMs);

    expect(result.remainingMs).toBeGreaterThanOrEqual(0);
    expect(result.breached).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// classifyDisplayState
// ---------------------------------------------------------------------------

describe('classifyDisplayState', () => {
  const WARNING_THRESHOLD = 15 * 60 * 1000; // 15 minutes

  it('returns "running" when remainingMs > warningThreshold and state is running', () => {
    expect(classifyDisplayState(20 * 60 * 1000, 'running', WARNING_THRESHOLD)).toBe('running');
  });

  it('returns "warning" when remainingMs <= warningThreshold', () => {
    expect(classifyDisplayState(10 * 60 * 1000, 'running', WARNING_THRESHOLD)).toBe('warning');
  });

  it('returns "warning" exactly at the threshold', () => {
    expect(classifyDisplayState(WARNING_THRESHOLD, 'running', WARNING_THRESHOLD)).toBe('warning');
  });

  it('returns "paused" regardless of remaining when timerState is paused', () => {
    expect(classifyDisplayState(1_000, 'paused', WARNING_THRESHOLD)).toBe('paused');
    expect(classifyDisplayState(0, 'paused', WARNING_THRESHOLD)).toBe('paused');
  });

  it('returns "breached" when timerState is breached', () => {
    expect(classifyDisplayState(5_000, 'breached', WARNING_THRESHOLD)).toBe('breached');
  });

  it('returns "breached" when remainingMs <= 0', () => {
    expect(classifyDisplayState(0, 'running', WARNING_THRESHOLD)).toBe('breached');
    expect(classifyDisplayState(-1, 'running', WARNING_THRESHOLD)).toBe('breached');
  });
});

// ---------------------------------------------------------------------------
// formatRemainingMs
// ---------------------------------------------------------------------------

describe('formatRemainingMs', () => {
  it('formats 0ms as "0s"', () => {
    expect(formatRemainingMs(0)).toBe('0s');
  });

  it('formats negative as "0s"', () => {
    expect(formatRemainingMs(-1)).toBe('0s');
  });

  it('formats seconds only', () => {
    expect(formatRemainingMs(45_000)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatRemainingMs(2 * 60 * 1000 + 30_000)).toBe('2m 30s');
  });

  it('formats hours, minutes and seconds', () => {
    expect(formatRemainingMs(2 * 3600_000 + 14 * 60_000 + 5_000)).toBe('2h 14m 5s');
  });

  it('formats days, hours, minutes and seconds', () => {
    expect(formatRemainingMs(1 * 86400_000 + 3 * 3600_000 + 5 * 60_000 + 10_000)).toBe('1d 3h 5m 10s');
  });

  it('omits leading zero parts (no "0h 30m")', () => {
    const result = formatRemainingMs(30 * 60_000 + 10_000);
    expect(result).toBe('30m 10s');
    expect(result).not.toContain('0h');
  });
});

// ---------------------------------------------------------------------------
// formatRemainingShort
// ---------------------------------------------------------------------------

describe('formatRemainingShort', () => {
  it('formats 0ms as "0s"', () => {
    expect(formatRemainingShort(0)).toBe('0s');
  });

  it('returns only seconds when under a minute', () => {
    expect(formatRemainingShort(30_000)).toBe('30s');
  });

  it('returns minutes and seconds when under an hour', () => {
    expect(formatRemainingShort(2 * 60_000 + 30_000)).toBe('2m 30s');
  });

  it('returns hours and minutes when over an hour', () => {
    expect(formatRemainingShort(2 * 3600_000 + 14 * 60_000)).toBe('2h 14m');
  });

  it('returns days and hours when over a day', () => {
    expect(formatRemainingShort(2 * 86400_000 + 5 * 3600_000)).toBe('2d 5h');
  });
});
