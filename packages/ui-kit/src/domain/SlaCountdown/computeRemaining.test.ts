import { describe, it, expect } from 'vitest';
import { computeRemaining, formatRemaining, buildAriaLabel } from './computeRemaining';
import {
  makeInput,
  INPUT_RUNNING_PLENTY,
  INPUT_BREACHED,
  INPUT_PAUSED,
  INPUT_ELAPSED_30S,
  BASE_TARGET_FUTURE,
  BASE_SERVER_NOW,
} from '../../../test/fixtures/sla.fixtures';

describe('computeRemaining', () => {
  it('returns positive remaining for a future target', () => {
    const result = computeRemaining(INPUT_RUNNING_PLENTY);
    expect(result.remainingMs).toBeGreaterThan(0);
    expect(result.derivedState).toBe('running');
    expect(result.isOverdue).toBe(false);
  });

  it('returns breached when target is in the past', () => {
    const result = computeRemaining(INPUT_BREACHED);
    expect(result.remainingMs).toBeLessThan(0);
    expect(result.derivedState).toBe('breached');
    expect(result.isOverdue).toBe(true);
  });

  it('returns paused state when serverState=paused', () => {
    const result = computeRemaining(INPUT_PAUSED);
    expect(result.derivedState).toBe('paused');
  });

  it('accounts for elapsed monotonic time', () => {
    const base = computeRemaining(INPUT_RUNNING_PLENTY);
    const withElapsed = computeRemaining(INPUT_ELAPSED_30S);
    // 30 seconds elapsed means 30s less remaining
    expect(base.remainingMs - withElapsed.remainingMs).toBeCloseTo(30_000, -2);
  });

  it('returns unknown for invalid targetAt', () => {
    const result = computeRemaining(makeInput({ targetAt: 'not-a-date' }));
    expect(result.derivedState).toBe('unknown');
    expect(result.remainingMs).toBe(0);
    expect(result.isOverdue).toBe(false);
  });

  it('returns unknown for invalid serverNow', () => {
    const result = computeRemaining(makeInput({ serverNow: '' }));
    expect(result.derivedState).toBe('unknown');
  });

  it('uses pausedMs to offset remaining time', () => {
    const without = computeRemaining(makeInput({ targetAt: BASE_TARGET_FUTURE, serverNow: BASE_SERVER_NOW }));
    const withPause = computeRemaining(makeInput({ targetAt: BASE_TARGET_FUTURE, serverNow: BASE_SERVER_NOW, pausedMs: 10_000 }));
    // pausedMs adds to remaining
    expect(withPause.remainingMs - without.remainingMs).toBeCloseTo(10_000, -2);
  });
});

describe('formatRemaining', () => {
  it('formats positive ms as MM:SS', () => {
    expect(formatRemaining(90_000)).toBe('01:30');
    expect(formatRemaining(3661_000)).toBe('61:01');
    expect(formatRemaining(0)).toBe('00:00');
  });

  it('formats negative ms with leading dash', () => {
    expect(formatRemaining(-90_000)).toBe('-01:30');
  });
});

describe('buildAriaLabel', () => {
  it('produces a human-readable label for running state', () => {
    const label = buildAriaLabel('running', 90_000);
    expect(label).toMatch(/running/i);
    expect(label).toMatch(/01:30/);
  });

  it('produces a label for breached state', () => {
    const label = buildAriaLabel('breached', -30_000);
    expect(label).toMatch(/breached|overdue/i);
  });

  it('handles paused state', () => {
    const label = buildAriaLabel('paused', 60_000);
    expect(label).toMatch(/paused/i);
  });
});
