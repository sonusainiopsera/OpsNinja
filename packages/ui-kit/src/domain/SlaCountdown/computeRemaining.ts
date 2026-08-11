/**
 * computeRemaining — pure, clock-injected SLA remaining-time calculator.
 *
 * No React, no DOM, no side effects. Deterministic given the same inputs,
 * so it can be exhaustively tested without fake timers.
 *
 * Formula (from WO-019 spec):
 *   effectiveNow = serverNow + (currentMonotonicMs - monotonicOffsetMs)
 *   remaining    = targetAt - effectiveNow + pausedMs
 *
 * The monotonic offset corrects for browser clock skew: the server timestamp
 * is accepted as authoritative on every delta, and the browser's monotonic
 * clock (performance.now) tracks elapsed time since that delta without being
 * subject to wall-clock adjustments or device sleep drift.
 */

import type { SlaState } from '../../slaStateMeta';

export type { SlaState };

export interface ComputeRemainingInput {
  /** ISO 8601 string — target deadline. */
  targetAt: string;
  /** ISO 8601 string — server clock at time of last delta. */
  serverNow: string;
  /** Accumulated paused milliseconds; must be >= 0 and finite. */
  pausedMs: number;
  /** Server-authoritative state received with the last delta. */
  serverState: SlaState;
  /** performance.now() value at the time of the last server delta. */
  monotonicOffsetMs: number;
  /** performance.now() value right now (injected so tests are deterministic). */
  currentMonotonicMs: number;
}

export interface ComputeRemainingResult {
  /** Remaining milliseconds. Negative when breached (overdue duration). */
  remainingMs: number;
  /** Client-derived state. May advance server state to 'breached' locally. */
  derivedState: SlaState | 'unknown';
  /** True when remainingMs < 0 (SLA has been breached). */
  isOverdue: boolean;
}

export function computeRemaining(input: ComputeRemainingInput): ComputeRemainingResult {
  const targetAtMs = Date.parse(input.targetAt);
  const serverNowMs = Date.parse(input.serverNow);

  if (
    !isFinite(targetAtMs) ||
    !isFinite(serverNowMs) ||
    !isFinite(input.pausedMs) ||
    input.pausedMs < 0
  ) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[SlaCountdown] computeRemaining received invalid input', input);
    }
    return { remainingMs: 0, derivedState: 'unknown', isOverdue: false };
  }

  const elapsedSinceDeltaMs = Math.max(0, input.currentMonotonicMs - input.monotonicOffsetMs);
  const effectiveNowMs = serverNowMs + elapsedSinceDeltaMs;
  const remainingMs = targetAtMs - effectiveNowMs + input.pausedMs;

  let derivedState: SlaState | 'unknown';

  if (input.serverState === 'paused') {
    // Paused: remaining is frozen, accumulation handled externally via pausedMs.
    derivedState = 'paused';
  } else if (input.serverState === 'breached' || remainingMs <= 0) {
    // Client may detect breach before the next server delta.
    derivedState = 'breached';
  } else if (input.serverState === 'warning' || input.serverState === 'running') {
    // Server state is authoritative for 'running' vs 'warning'.
    derivedState = input.serverState;
  } else {
    // Tolerate legacy/alias values such as 'ok' from mocks or older APIs.
    derivedState = 'running';
  }

  return { remainingMs, derivedState, isOverdue: remainingMs < 0 };
}

/** Format remaining milliseconds as MM:SS for display. */
export function formatRemaining(remainingMs: number): string {
  const abs = Math.abs(remainingMs);
  const totalSeconds = Math.floor(abs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const prefix = remainingMs < 0 ? '-' : '';
  return `${prefix}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Returns a human-readable accessible label for the current state+time. */
export function buildAriaLabel(derivedState: SlaState | 'unknown', remainingMs: number): string {
  if (derivedState === 'unknown') return 'SLA status unknown';
  if (derivedState === 'paused') return 'SLA paused';
  if (derivedState === 'breached') {
    const overdueSec = Math.floor(Math.abs(remainingMs) / 1000);
    return `SLA breached, overdue by ${overdueSec} seconds`;
  }
  const sec = Math.floor(remainingMs / 1000);
  const min = Math.floor(sec / 60);
  const label = derivedState === 'warning' ? 'SLA at risk' : 'SLA on track';
  return `${label}, ${min} minutes ${sec % 60} seconds remaining`;
}

declare const __DEV__: boolean | undefined;
