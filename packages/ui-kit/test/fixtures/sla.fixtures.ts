import type { ComputeRemainingInput } from '../../src/domain/SlaCountdown/computeRemaining';
import type { SlaState } from '../../src/slaStateMeta';

export const BASE_SERVER_NOW = '2024-01-01T12:00:00.000Z';
export const BASE_TARGET_FUTURE = '2024-01-01T13:00:00.000Z'; // 60 min from now
export const BASE_TARGET_WARNING = '2024-01-01T12:08:00.000Z'; // 8 min from now (~13% remaining for 60min SLA)
export const BASE_TARGET_PAST = '2024-01-01T11:00:00.000Z'; // 60 min overdue

export function makeInput(overrides?: Partial<ComputeRemainingInput>): ComputeRemainingInput {
  return {
    targetAt: BASE_TARGET_FUTURE,
    serverNow: BASE_SERVER_NOW,
    pausedMs: 0,
    serverState: 'running' as SlaState,
    monotonicOffsetMs: 1000,
    currentMonotonicMs: 1000,
    ...overrides,
  };
}

export const INPUT_RUNNING_PLENTY = makeInput();

export const INPUT_RUNNING_WARNING = makeInput({
  targetAt: BASE_TARGET_WARNING,
  serverState: 'warning',
});

export const INPUT_BREACHED = makeInput({
  targetAt: BASE_TARGET_PAST,
  serverState: 'breached',
});

export const INPUT_PAUSED = makeInput({
  serverState: 'paused',
  pausedMs: 120_000,
  targetAt: BASE_TARGET_WARNING,
});

export const INPUT_ELAPSED_30S = makeInput({
  monotonicOffsetMs: 0,
  currentMonotonicMs: 30_000,
});
