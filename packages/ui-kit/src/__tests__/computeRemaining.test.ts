import { describe, expect, it } from 'vitest';
import { computeRemaining, formatDuration } from '../domain/SlaCountdown/computeRemaining';
import { makeComputeInput, advancedClock } from '../fixtures/sla.fixtures';

describe('computeRemaining', () => {
  const serverNow = '2024-01-15T10:00:00.000Z';
  const targetAt2h = '2024-01-15T12:00:00.000Z'; // 2h remaining

  describe('running state', () => {
    it('returns correct remaining ms with no elapsed time', () => {
      const result = computeRemaining(makeComputeInput({
        serverNow,
        targetAt: targetAt2h,
        getCurrentMonoMs: () => 0,
        monoBaseMs: 0,
        serverState: 'running',
      }));
      expect(result.isInvalid).toBe(false);
      expect(result.displayState).toBe('running');
      expect(result.remainingMs).toBe(2 * 60 * 60 * 1000);
    });

    it('subtracts elapsed time from remaining', () => {
      const result = computeRemaining(makeComputeInput({
        serverNow,
        targetAt: targetAt2h,
        monoBaseMs: 0,
        getCurrentMonoMs: () => 30_000, // 30s elapsed
        serverState: 'running',
      }));
      expect(result.remainingMs).toBe(2 * 60 * 60 * 1000 - 30_000);
    });

    it('formats 2h as H:MM:SS', () => {
      const result = computeRemaining(makeComputeInput({
        serverNow,
        targetAt: targetAt2h,
        getCurrentMonoMs: () => 0,
        monoBaseMs: 0,
        serverState: 'running',
      }));
      expect(result.formattedTime).toBe('2:00:00');
    });
  });

  describe('warning state', () => {
    it('transitions to warning when <= 25% remains (75% threshold)', () => {
      // total window = 2h = 7200s
      // warn at 25% remaining = 30min
      // 31 minutes remaining = not warning
      const result = computeRemaining(makeComputeInput({
        serverNow,
        targetAt: '2024-01-15T10:31:00.000Z', // 31min remaining
        getCurrentMonoMs: () => 0,
        monoBaseMs: 0,
        serverState: 'running',
        warningThresholdPct: 75,
      }));
      expect(result.displayState).toBe('running');
    });

    it('enters warning state when at the threshold boundary', () => {
      // total window = 31min; warn at 25% = ~7.75min
      // Let's use a bigger total so math is cleaner
      // target = 2h from serverNow; at 25% = 30min remaining
      const target30min = '2024-01-15T10:30:00.000Z';
      const total = 30 * 60 * 1000;
      // elapsed such that exactly 25% remains
      const elapsed = total * 0.75; // 22.5min elapsed
      const result = computeRemaining(makeComputeInput({
        serverNow,
        targetAt: target30min,
        monoBaseMs: 0,
        getCurrentMonoMs: () => elapsed,
        serverState: 'running',
        warningThresholdPct: 75,
      }));
      // remainingMs = 30min - 22.5min = 7.5min, pctRemaining = 25%, trigger = 25% → warning
      expect(result.displayState).toBe('warning');
    });
  });

  describe('paused state', () => {
    it('freezes the clock — elapsed time is not subtracted', () => {
      const base = makeComputeInput({
        serverNow,
        targetAt: targetAt2h,
        pausedMs: 0,
        monoBaseMs: 0,
        serverState: 'paused',
      });
      const resultAt0 = computeRemaining({ ...base, getCurrentMonoMs: () => 0 });
      const resultAt60s = computeRemaining({ ...base, getCurrentMonoMs: () => 60_000 });
      expect(resultAt0.remainingMs).toBe(resultAt60s.remainingMs);
      expect(resultAt0.displayState).toBe('paused');
    });

    it('includes pausedMs in remaining when paused', () => {
      const result = computeRemaining(makeComputeInput({
        serverNow,
        targetAt: targetAt2h,
        pausedMs: 30 * 60 * 1000,
        monoBaseMs: 0,
        getCurrentMonoMs: () => 0,
        serverState: 'paused',
      }));
      expect(result.remainingMs).toBe(2 * 60 * 60 * 1000 + 30 * 60 * 1000);
    });
  });

  describe('breached state', () => {
    it('returns negative remainingMs when past deadline', () => {
      const result = computeRemaining(makeComputeInput({
        serverNow,
        targetAt: '2024-01-15T09:00:00.000Z', // 1h ago
        getCurrentMonoMs: () => 0,
        monoBaseMs: 0,
        serverState: 'running',
      }));
      expect(result.remainingMs).toBeLessThan(0);
      expect(result.displayState).toBe('breached');
    });

    it('formats negative time with + prefix', () => {
      const result = computeRemaining(makeComputeInput({
        serverNow,
        targetAt: '2024-01-15T09:00:00.000Z', // 1h ago
        getCurrentMonoMs: () => 0,
        monoBaseMs: 0,
        serverState: 'running',
      }));
      expect(result.formattedTime).toMatch(/^\+/);
    });
  });

  describe('invalid inputs', () => {
    it('returns isInvalid=true for bad targetAt', () => {
      const result = computeRemaining(makeComputeInput({ targetAt: 'not-a-date' }));
      expect(result.isInvalid).toBe(true);
      expect(result.displayState).toBe('unknown');
      expect(result.formattedTime).toBe('--:--');
    });

    it('returns isInvalid=true for bad serverNow', () => {
      const result = computeRemaining(makeComputeInput({ serverNow: 'bad' }));
      expect(result.isInvalid).toBe(true);
    });

    it('returns isInvalid=true for negative pausedMs', () => {
      const result = computeRemaining(makeComputeInput({ pausedMs: -1 }));
      expect(result.isInvalid).toBe(true);
    });
  });
});

describe('formatDuration', () => {
  it('formats 0 as 0:00', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('formats 90s as 1:30', () => {
    expect(formatDuration(90_000)).toBe('1:30');
  });

  it('formats 3661s as 1:01:01', () => {
    expect(formatDuration(3_661_000)).toBe('1:01:01');
  });

  it('formats negative ms with + prefix', () => {
    expect(formatDuration(-90_000)).toBe('+1:30');
  });

  it('formats large negative as +H:MM:SS', () => {
    expect(formatDuration(-3_661_000)).toBe('+1:01:01');
  });
});
