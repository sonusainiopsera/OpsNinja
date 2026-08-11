import type { ComputeRemainingInput } from '../domain/SlaCountdown/computeRemaining';

const BASE_SERVER_NOW = '2024-01-15T10:00:00.000Z';
const BASE_TARGET_AT  = '2024-01-15T12:00:00.000Z'; // 2h from now

export const slaFixtures = {
  running: {
    state: 'running' as const,
    serverNow: BASE_SERVER_NOW,
    targetAt: BASE_TARGET_AT,
    pausedMs: 0,
    displayTime: '1h 55m',
  },
  warning: {
    state: 'warning' as const,
    serverNow: BASE_SERVER_NOW,
    targetAt: '2024-01-15T10:20:00.000Z', // 20m remaining, past 75% threshold
    pausedMs: 0,
    displayTime: '18m',
  },
  paused: {
    state: 'paused' as const,
    serverNow: BASE_SERVER_NOW,
    targetAt: BASE_TARGET_AT,
    pausedMs: 30 * 60 * 1000, // 30m already paused
    displayTime: '2h 30m',
  },
  breached: {
    state: 'breached' as const,
    serverNow: BASE_SERVER_NOW,
    targetAt: '2024-01-15T09:00:00.000Z', // 1h ago
    pausedMs: 0,
    displayTime: '+1h 5m',
  },
};

export function makeComputeInput(
  overrides: Partial<ComputeRemainingInput> = {},
): ComputeRemainingInput {
  let monoMs = 0;
  return {
    targetAt: BASE_TARGET_AT,
    serverNow: BASE_SERVER_NOW,
    pausedMs: 0,
    monoBaseMs: 0,
    getCurrentMonoMs: () => monoMs,
    serverState: 'running',
    ...overrides,
  };
}

/** Advance the fake monotonic clock by `ms`. Returns a new getCurrentMonoMs. */
export function advancedClock(startMs: number, advanceMs: number): () => number {
  return () => startMs + advanceMs;
}
