/**
 * countdown.ts — pure SLA countdown interpolation math (WO-070, AC4).
 *
 * All functions are free of React, browser globals and network concerns.
 * They are designed to be called every second from a shared ticker.
 *
 * Key rules from the WO:
 *   - remaining = remainingMs - (now - generatedAt) for running timers
 *   - Freeze (return paused remainingMs) when timerState is 'paused'
 *   - Clamp to zero when computed remaining < 0 but server hasn't confirmed
 *     breach yet (show 'breach imminent' at 0, not negative)
 *   - Colour thresholds come from the server-provided row, not local business rules
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** SLA visual state for rendering. */
export type SlaDisplayState = 'running' | 'warning' | 'paused' | 'breached';

export interface CountdownInput {
  /** Remaining milliseconds as reported at generatedAt. */
  remainingMs: number;
  /** Accumulated paused milliseconds. */
  pausedMs: number;
  /** ISO-8601 string when the snapshot/frame was generated. */
  generatedAt: string;
  /**
   * Server-reported timer state.
   * 'paused' → freeze; anything else → interpolate.
   */
  timerState: string;
}

export interface CountdownResult {
  /** Interpolated remaining milliseconds (≥ 0). */
  remainingMs: number;
  /** Whether the SLA has been breached (remaining <= 0 or timerState='breached'). */
  breached: boolean;
  /** Display state for colour coding. */
  displayState: SlaDisplayState;
  /** Human-readable label, e.g. "2h 14m" or "Breached" or "Paused". */
  label: string;
  /** Formatted seconds portion for live countdown rendering. */
  secondsLabel: string;
}

// ---------------------------------------------------------------------------
// Core interpolation
// ---------------------------------------------------------------------------

/**
 * Compute the current countdown value from a server-provided row.
 *
 * @param input  — row fields from BreachRiskRow + generatedAt
 * @param nowMs  — current epoch ms (injected for testability; default Date.now())
 */
export function computeCountdown(input: CountdownInput, nowMs?: number): CountdownResult {
  const now = nowMs ?? Date.now();
  const generatedAtMs = new Date(input.generatedAt).getTime();

  if (input.timerState === 'paused') {
    return buildResult(Math.max(0, input.remainingMs), 'paused');
  }

  if (input.timerState === 'breached' || input.remainingMs < 0) {
    return buildResult(0, 'breached');
  }

  const elapsed = now - generatedAtMs;
  const remaining = input.remainingMs - elapsed;

  if (remaining <= 0) {
    // Clamp: server hasn't confirmed breach yet — show "breach imminent"
    return buildResult(0, 'breached');
  }

  return buildResult(remaining, 'running');
}

// ---------------------------------------------------------------------------
// Display-state classification
// ---------------------------------------------------------------------------

/**
 * Classify into running / warning / paused / breached given remaining ms and
 * server-provided reminder thresholds.
 *
 * @param remainingMs   interpolated remaining milliseconds
 * @param timerState    server-reported state ('paused', 'breached', 'running', …)
 * @param warningThresholdMs  threshold below which state becomes 'warning'
 */
export function classifyDisplayState(
  remainingMs: number,
  timerState: string,
  warningThresholdMs: number,
): SlaDisplayState {
  if (timerState === 'paused') return 'paused';
  if (timerState === 'breached' || remainingMs <= 0) return 'breached';
  if (remainingMs <= warningThresholdMs) return 'warning';
  return 'running';
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format milliseconds as "Xd Yh Zm Ws" dropping leading zero parts, min "0s". */
export function formatRemainingMs(ms: number): string {
  if (ms <= 0) return '0s';

  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);

  return parts.join(' ');
}

/** Truncated label: show only the two most significant parts for panel display. */
export function formatRemainingShort(ms: number): string {
  if (ms <= 0) return '0s';

  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildResult(remainingMs: number, state: SlaDisplayState): CountdownResult {
  const clamped = Math.max(0, remainingMs);
  const breached = state === 'breached';

  let label: string;
  let secondsLabel = '';

  if (breached) {
    label = 'Breached';
  } else if (state === 'paused') {
    label = `Paused · ${formatRemainingShort(clamped)}`;
  } else {
    label = formatRemainingShort(clamped);
    const s = Math.floor(clamped / 1000) % 60;
    secondsLabel = String(s).padStart(2, '0');
  }

  return { remainingMs: clamped, breached, displayState: state, label, secondsLabel };
}
