/**
 * computeRemaining – pure, clock-injected SLA remaining-time calculation.
 *
 * The browser clock is never used as the authority.  Instead:
 *   1. On each server delta the caller captures monoBaseMs = performance.now()
 *      and serverNowMs = new Date(serverNow).getTime().
 *   2. On each local tick the caller calls getCurrentMonoMs() (defaults to
 *      performance.now) and passes it in.
 *   3. elapsedSinceDelta = currentMonoMs - monoBaseMs
 *   4. remaining = targetAtMs - (serverNowMs + elapsedSinceDelta) + pausedMs
 *
 * When state is 'paused' the elapsed time is not added: the clock is frozen.
 * When remainingMs <= 0 the display shows overdue time (negative remaining).
 *
 * Invalid inputs are validated and return an 'unknown' outcome so callers
 * never render NaN.
 */

import type { SlaState } from '../../tokens/sla-state-meta';

export interface ComputeRemainingInput {
  /** ISO timestamp of the SLA deadline. */
  targetAt: string;
  /** ISO timestamp of the server's current time at the last received delta. */
  serverNow: string;
  /** Accumulated pause duration in milliseconds (≥ 0). */
  pausedMs: number;
  /** performance.now() value captured when the last server delta was received. */
  monoBaseMs: number;
  /**
   * performance.now()-equivalent for the current tick.
   * Injected for deterministic testing; defaults to () => performance.now().
   */
  getCurrentMonoMs?: () => number;
  /**
   * Percentage of the total SLA window at which the 'warning' state is entered
   * (e.g. 75 means warn when 25 % of time remains).  Default: 75.
   */
  warningThresholdPct?: number;
  /**
   * The server-authoritative SLA state.  Used to preserve 'paused' state
   * and as a fallback when client-side derivation is ambiguous.
   */
  serverState: SlaState;
}

export type SlaDisplayState = SlaState | 'unknown';

export interface ComputeRemainingResult {
  /** Remaining milliseconds. Negative when breached (overdue time). */
  remainingMs: number;
  /** Client-derived display state. May advance ahead of serverState on a tick. */
  displayState: SlaDisplayState;
  /** Human-readable HH:MM:SS or +HH:MM:SS (overdue). */
  formattedTime: string;
  /** True when the input was invalid; callers should render an unknown state. */
  isInvalid: boolean;
}

const DEFAULT_WARNING_PCT = 75;

export function computeRemaining(input: ComputeRemainingInput): ComputeRemainingResult {
  const {
    targetAt,
    serverNow,
    pausedMs,
    monoBaseMs,
    getCurrentMonoMs = () => performance.now(),
    warningThresholdPct = DEFAULT_WARNING_PCT,
    serverState,
  } = input;

  // ── Validation ─────────────────────────────────────────────────────────────
  const targetAtMs = Date.parse(targetAt);
  const serverNowMs = Date.parse(serverNow);

  if (
    isNaN(targetAtMs) ||
    isNaN(serverNowMs) ||
    !isFinite(pausedMs) ||
    pausedMs < 0
  ) {
    if (process.env['NODE_ENV'] !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[SlaCountdown] computeRemaining: invalid input', {
        targetAt,
        serverNow,
        pausedMs,
      });
    }
    return {
      remainingMs: 0,
      displayState: 'unknown',
      formattedTime: '--:--',
      isInvalid: true,
    };
  }

  // ── Remaining calculation ───────────────────────────────────────────────────
  let remainingMs: number;

  if (serverState === 'paused') {
    // Clock is frozen while paused; elapsedSinceDelta is not applied.
    remainingMs = targetAtMs - serverNowMs + pausedMs;
  } else {
    const currentMonoMs = getCurrentMonoMs();
    const elapsedSinceDelta = Math.max(0, currentMonoMs - monoBaseMs);
    remainingMs = targetAtMs - (serverNowMs + elapsedSinceDelta) + pausedMs;
  }

  // ── State derivation ────────────────────────────────────────────────────────
  let displayState: SlaDisplayState;

  if (serverState === 'paused') {
    displayState = 'paused';
  } else if (remainingMs <= 0) {
    displayState = 'breached';
  } else {
    // Total SLA window from server-now perspective (without paused offset already baked in)
    const totalWindowMs = targetAtMs - serverNowMs + pausedMs;
    const pctRemaining = totalWindowMs > 0 ? (remainingMs / totalWindowMs) * 100 : 0;
    const warningTriggerPct = 100 - warningThresholdPct;

    displayState = pctRemaining <= warningTriggerPct ? 'warning' : 'running';
  }

  // ── Formatting ──────────────────────────────────────────────────────────────
  const formattedTime = formatDuration(remainingMs);

  return { remainingMs, displayState, formattedTime, isInvalid: false };
}

/** Formats a duration in ms to ±H:MM:SS. */
export function formatDuration(ms: number): string {
  const sign = ms < 0 ? '+' : '';
  const absMs = Math.abs(ms);
  const totalSeconds = Math.floor(absMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const pad = (n: number) => String(n).padStart(2, '0');

  return hours > 0
    ? `${sign}${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${sign}${minutes}:${pad(seconds)}`;
}
