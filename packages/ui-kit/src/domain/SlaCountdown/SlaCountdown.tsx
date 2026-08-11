/**
 * SlaCountdown — agent-facing SLA remaining-time pill.
 *
 * Receives server deltas every ~5 seconds and interpolates locally between
 * them using the shared SlaClockProvider ticker and a monotonic offset
 * captured on each delta to avoid relying on the browser clock.
 *
 * State is communicated by colour token (data attribute) + icon + text label
 * so colour-blind users still receive the full signal.
 *
 * An aria-live announcement fires exactly once per state transition (e.g.
 * running → warning, running → breached) to alert screen-reader users
 * without creating an announcement storm on large queues.
 *
 * SlaCountdown MUST be mounted inside a SlaClockProvider.
 */

import React, { useEffect, useRef } from 'react';
import { useSlaClockContext } from '../SlaClockProvider';
import { computeRemaining } from './computeRemaining';
import type { SlaDisplayState } from './computeRemaining';
import {
  slaStateMeta,
  assertNeverSlaState,
  type SlaState,
} from '../../tokens/sla-state-meta';

export interface SlaCountdownProps {
  /** Server-authoritative SLA state. */
  state: SlaState;
  /** ISO timestamp of the SLA deadline. */
  targetAt: string;
  /** Accumulated pause duration in ms from the server. */
  pausedMs: number;
  /** ISO timestamp of the server's wall clock at the time this delta was emitted. */
  serverNow: string;
  /** Warning threshold as percentage of elapsed window (default 75). */
  warningThresholdPct?: number;
  /** Additional CSS class name. */
  className?: string;
}

// Inline styles for the pill (CSS tokens resolved by host application)
const stateStyles: Record<SlaDisplayState, React.CSSProperties> = {
  running:  { color: 'var(--color-sla-running-text, #166534)',  background: 'var(--color-sla-running-bg,  #dcfce7)' },
  warning:  { color: 'var(--color-sla-warning-text, #92400e)',  background: 'var(--color-sla-warning-bg,  #fef3c7)' },
  paused:   { color: 'var(--color-sla-paused-text,  #1e40af)',  background: 'var(--color-sla-paused-bg,   #dbeafe)' },
  breached: { color: 'var(--color-sla-breached-text, #991b1b)', background: 'var(--color-sla-breached-bg,  #fee2e2)' },
  unknown:  { color: 'var(--color-sla-unknown-text,  #374151)', background: 'var(--color-sla-unknown-bg,   #f3f4f6)' },
};

// Icon components (host replaces with real icon set; using text symbols as fallback)
function SlaIcon({ state }: { state: SlaDisplayState }) {
  const icons: Record<SlaDisplayState, string> = {
    running:  '⏱',
    warning:  '⚠',
    paused:   '⏸',
    breached: '⚡',
    unknown:  '?',
  };
  return (
    <span aria-hidden="true" data-icon={state}>
      {icons[state]}
    </span>
  );
}

export function SlaCountdown({
  state,
  targetAt,
  pausedMs,
  serverNow,
  warningThresholdPct = 75,
  className,
}: SlaCountdownProps) {
  const { tick, getMonoMs, announce } = useSlaClockContext();

  // Capture monotonic base when serverNow changes (new delta arrived)
  const monoBaseRef = useRef<number>(getMonoMs());
  const prevServerNowRef = useRef<string>(serverNow);

  if (serverNow !== prevServerNowRef.current) {
    prevServerNowRef.current = serverNow;
    monoBaseRef.current = getMonoMs();
  }

  // Track previous display state for transition announcements
  const prevDisplayStateRef = useRef<SlaDisplayState | null>(null);

  const result = computeRemaining({
    targetAt,
    serverNow,
    pausedMs,
    monoBaseMs: monoBaseRef.current,
    getCurrentMonoMs: getMonoMs,
    warningThresholdPct,
    serverState: state,
  });

  const { displayState, formattedTime, isInvalid } = result;

  // Announce exactly once per transition to warning or breached
  useEffect(() => {
    if (!isInvalid && prevDisplayStateRef.current !== null) {
      if (
        displayState !== prevDisplayStateRef.current &&
        (displayState === 'warning' || displayState === 'breached')
      ) {
        const meta = displayState === 'unknown' ? null : slaStateMeta[displayState as SlaState];
        if (meta) {
          announce(`SLA ${meta.label}: ${formattedTime} remaining`);
        }
      }
    }
    prevDisplayStateRef.current = displayState;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayState]);

  // Suppress unused variable warning — tick drives re-renders
  void tick;

  const metaKey = displayState === 'unknown' ? null : (displayState as SlaState);
  const meta = metaKey ? slaStateMeta[metaKey] : null;

  // Exhaustiveness check for server state (compile error on new SlaState values)
  const _exhaustive: SlaState = state;
  switch (_exhaustive) {
    case 'running':
    case 'warning':
    case 'paused':
    case 'breached':
      break;
    default:
      assertNeverSlaState(_exhaustive);
  }

  const style = stateStyles[displayState];
  const accessibleLabel = isInvalid
    ? 'SLA status unknown'
    : `${meta?.ariaLabel ?? displayState}, ${displayState === 'breached' ? 'overdue by' : 'remaining'} ${formattedTime}`;

  return (
    <span
      role="img"
      aria-label={accessibleLabel}
      data-testid="sla-countdown"
      data-sla-state={displayState}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding: '0.125rem 0.5rem',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {!isInvalid && <SlaIcon state={displayState} />}
      <span data-sla-label>{meta?.label ?? 'Unknown'}</span>
      <span data-sla-time>{formattedTime}</span>
    </span>
  );
}
