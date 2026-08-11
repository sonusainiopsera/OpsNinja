/**
 * SlaHint — portal-safe SLA affordance.
 *
 * This component intentionally does NOT import SlaCountdown or SlaClockProvider.
 * The customer portal must not transitively depend on the agent SLA clock.
 *
 * SlaHint shows a static state badge (no live countdown) fed by whatever
 * server-side SLA state the portal endpoint chooses to expose.
 */

import React from 'react';
import { slaStateMeta, type SlaState } from '../../tokens/sla-state-meta';

export interface SlaHintProps {
  state: SlaState;
  /** Human-readable time string provided by the server (e.g. "2h 15m"). */
  displayTime?: string;
  className?: string;
}

const hintStyles: Record<SlaState, React.CSSProperties> = {
  running:  { color: 'var(--color-sla-running-text,  #166534)', background: 'var(--color-sla-running-bg,  #dcfce7)' },
  warning:  { color: 'var(--color-sla-warning-text,  #92400e)', background: 'var(--color-sla-warning-bg,  #fef3c7)' },
  paused:   { color: 'var(--color-sla-paused-text,   #1e40af)', background: 'var(--color-sla-paused-bg,   #dbeafe)' },
  breached: { color: 'var(--color-sla-breached-text, #991b1b)', background: 'var(--color-sla-breached-bg,  #fee2e2)' },
};

export function SlaHint({ state, displayTime, className }: SlaHintProps) {
  const meta = slaStateMeta[state];
  const accessibleLabel = displayTime
    ? `${meta.ariaLabel}, ${displayTime}`
    : meta.ariaLabel;

  return (
    <span
      role="img"
      aria-label={accessibleLabel}
      data-testid="sla-hint"
      data-sla-state={state}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding: '0.125rem 0.5rem',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        ...hintStyles[state],
      }}
    >
      <span aria-hidden="true" data-icon={meta.iconName}>
        {iconFallback(state)}
      </span>
      <span data-sla-label>{meta.label}</span>
      {displayTime && <span data-sla-time>{displayTime}</span>}
    </span>
  );
}

function iconFallback(state: SlaState): string {
  switch (state) {
    case 'running':  return '⏱';
    case 'warning':  return '⚠';
    case 'paused':   return '⏸';
    case 'breached': return '⚡';
  }
}
