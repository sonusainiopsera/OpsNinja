/**
 * SlaHint — portal-safe, non-ticking, low-detail SLA affordance.
 *
 * CONSTRAINTS:
 *   - Must NOT import SlaCountdown, SlaClockProvider, or computeRemaining.
 *   - No ticking, no shared timer, no side effects.
 *   - Shows only the server-provided state with icon + label.
 *   - Safe to use in the customer portal bundle.
 *
 * The dependency-graph test (portal-dependency-graph.test.ts) asserts that
 * no transitive import of SlaCountdown or SlaClockProvider is reachable from
 * this file.
 */

import React from 'react';
import { slaStateMeta, type SlaState } from '../../slaStateMeta';
import { Icon } from '../../Icon';

export interface SlaHintProps {
  /** Server-provided SLA state. */
  state: SlaState;
  /** Optional overdue/remaining label already computed by the server. */
  timeLabel?: string;
  className?: string;
}

export function SlaHint({ state, timeLabel, className }: SlaHintProps) {
  const meta = slaStateMeta[state];

  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 4,
    background: `var(${meta.bgVar})`,
    color: `var(${meta.colorVar})`,
    fontSize: 12,
    userSelect: 'none',
  };

  const label = timeLabel ? `${meta.label} — ${timeLabel}` : meta.label;

  return (
    <span
      className={className}
      aria-label={`SLA status: ${label}`}
      data-sla-state={state}
      style={style}
    >
      <Icon name={meta.iconName} size={12} />
      <span>{label}</span>
    </span>
  );
}
