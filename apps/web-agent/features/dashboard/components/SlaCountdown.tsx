'use client';

/**
 * SlaCountdown — per-row SLA countdown pill (WO-070, AC4).
 *
 * Receives pre-computed countdown data (driven by a SINGLE shared ticker in
 * DashboardPage, not an interval per row). Colour-codes via slaStateMeta and
 * always shows an icon + label so colour is never the sole breach indicator.
 *
 * Accessibility: uses aria-live="polite" for state announcements so screen
 * readers hear "SLA breached" when state changes, without interrupting reading.
 */

import React, { useEffect, useRef } from 'react';
import { Icon, slaStateMeta } from '@opsninja/ui-kit';
import type { SlaState } from '@opsninja/ui-kit';
import type { CountdownResult } from '../state/countdown';

export interface SlaCountdownProps {
  result: CountdownResult;
  /** Compact mode: show only time, no label. */
  compact?: boolean;
}

export function SlaCountdown({ result, compact = false }: SlaCountdownProps) {
  const { displayState, label, secondsLabel, remainingMs } = result;

  // Map our display state to slaStateMeta's SlaState type
  const slaState: SlaState =
    displayState === 'warning'
      ? 'warning'
      : displayState === 'paused'
        ? 'paused'
        : displayState === 'breached'
          ? 'breached'
          : 'running';

  const meta = slaStateMeta[slaState];

  // Track previous state for announcements
  const prevStateRef = useRef<string>(displayState);
  const announcementRef = useRef<string>('');

  useEffect(() => {
    if (prevStateRef.current !== displayState && meta.announcement) {
      announcementRef.current = meta.announcement;
    }
    prevStateRef.current = displayState;
  }, [displayState, meta.announcement]);

  // Format total minutes for compact secondary label
  const totalMinutes = Math.floor(remainingMs / 60000);
  const hoursDisplay = Math.floor(totalMinutes / 60);
  const minutesDisplay = totalMinutes % 60;
  const timeDisplay =
    displayState === 'breached'
      ? 'Breached'
      : compact
        ? label
        : hoursDisplay > 0
          ? `${hoursDisplay}h ${minutesDisplay}m ${secondsLabel}s`
          : minutesDisplay > 0
            ? `${minutesDisplay}m ${secondsLabel}s`
            : `${secondsLabel}s`;

  return (
    <span
      aria-label={`SLA ${meta.label}: ${label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: compact ? '2px 6px' : '3px 8px',
        borderRadius: 9999,
        fontSize: compact ? 11 : 12,
        fontWeight: 500,
        background: `var(${meta.bgVar})`,
        color: `var(${meta.colorVar})`,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon name={meta.iconName} size={compact ? 11 : 12} />
      <span>{compact ? label : timeDisplay}</span>

      {/* Accessible live announcement — only fires on state change */}
      {announcementRef.current && (
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}
        >
          {announcementRef.current}
        </span>
      )}
    </span>
  );
}
