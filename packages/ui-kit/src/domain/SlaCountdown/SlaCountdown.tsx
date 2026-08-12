/**
 * SlaCountdown — SLA remaining-time pill for the agent queue.
 *
 * State communicated by colour + icon + text label (never colour alone).
 * Subscribes to the shared SlaClockProvider ticker (one ticker per page).
 * Accepts 5-second server deltas via props; interpolates between them.
 * Announces state transitions (warning, breached) once via aria-live.
 *
 * Reduced-motion: @media (prefers-reduced-motion) suppresses the pulse animation.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useSlaClockContext } from '../SlaClockProvider';
import {
  computeRemaining,
  formatRemaining,
  buildAriaLabel,
  type ComputeRemainingInput,
} from './computeRemaining';
import { slaStateMeta, type SlaState } from '../../slaStateMeta';
import { Icon } from '../../Icon';

export interface SlaCountdownProps {
  /** Target deadline (ISO 8601). */
  targetAt: string;
  /** Accumulated paused milliseconds (>= 0). */
  pausedMs: number;
  /** Server-authoritative SLA state from the last WebSocket delta. */
  state: SlaState;
  /** Server clock at the time of the last delta (ISO 8601). */
  serverNow: string;
  /** Optional: warning threshold percentage of total duration (default 25). */
  warningThresholdPct?: number;
  className?: string;
}

export function SlaCountdown({
  targetAt,
  pausedMs,
  state,
  serverNow,
  className,
}: SlaCountdownProps) {
  const { subscribe, announce, clock } = useSlaClockContext();

  // Capture monotonic offset whenever a new server delta arrives.
  const monotonicOffsetRef = useRef<number>(clock.now());
  const prevServerNowRef = useRef<string>(serverNow);

  if (prevServerNowRef.current !== serverNow) {
    prevServerNowRef.current = serverNow;
    monotonicOffsetRef.current = clock.now();
  }

  function compute(currentMs: number): ReturnType<typeof computeRemaining> {
    const input: ComputeRemainingInput = {
      targetAt,
      serverNow,
      pausedMs,
      serverState: state,
      monotonicOffsetMs: monotonicOffsetRef.current,
      currentMonotonicMs: currentMs,
    };
    return computeRemaining(input);
  }

  const [result, setResult] = useState(() => compute(clock.now()));
  const prevStateRef = useRef<typeof result.derivedState>(result.derivedState);

  useEffect(() => {
    // Re-run compute immediately when props change.
    setResult(compute(clock.now()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetAt, serverNow, pausedMs, state]);

  useEffect(() => {
    return subscribe(({ currentMs }) => {
      setResult(compute(currentMs));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, targetAt, serverNow, pausedMs, state]);

  // Announce state transitions once per entry into warning / breached.
  useEffect(() => {
    const prev = prevStateRef.current;
    const next = result.derivedState;
    if (next !== prev) {
      prevStateRef.current = next;
      if (next === 'warning' || next === 'breached') {
        const meta = slaStateMeta[next as SlaState];
        if (meta?.announcement) announce(meta.announcement);
      }
    }
  }, [result.derivedState, announce]);

  if (result.derivedState === 'unknown') {
    return (
      <span
        className={className}
        data-testid="sla-countdown"
        role="img"
        aria-label="SLA status unknown"
        data-sla-state="unknown"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, background: 'var(--sla-paused-bg, #f3f4f6)', color: 'var(--sla-paused-fg, #374151)', fontSize: 12 }}
      >
        <Icon name="alert-triangle" size={12} />
        <span data-sla-label="true">Unknown</span>
      </span>
    );
  }

  const effectiveState = result.derivedState as SlaState;
  const meta = slaStateMeta[effectiveState] ?? slaStateMeta.running;
  const displayTime = formatRemaining(result.remainingMs);
  const ariaLabel = buildAriaLabel(
    slaStateMeta[effectiveState] ? effectiveState : 'unknown',
    result.remainingMs,
  );

  // Breached: show overdue as "+MM:SS" with a leading plus sign.
  const displayTimeFormatted = result.isOverdue
    ? `+${formatRemaining(Math.abs(result.remainingMs))}`
    : displayTime;

  const pillStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 4,
    background: `var(${meta.bgVar})`,
    color: `var(${meta.colorVar})`,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    userSelect: 'none',
  };

  return (
    <span
      className={className}
      data-testid="sla-countdown"
      role="img"
      aria-label={ariaLabel}
      data-sla-state={slaStateMeta[effectiveState] ? effectiveState : 'unknown'}
      style={pillStyle}
    >
      <Icon name={meta.iconName} size={12} />
      {/* Label — visible text plus accessible state description */}
      <span aria-hidden="true" data-sla-label="true">{meta.label}</span>
      {/* Time display — aria-hidden so screen readers use the full aria-label */}
      <span style={{ marginLeft: 2 }} aria-hidden="true" data-sla-time="true">
        {displayTimeFormatted}
      </span>
    </span>
  );
}
