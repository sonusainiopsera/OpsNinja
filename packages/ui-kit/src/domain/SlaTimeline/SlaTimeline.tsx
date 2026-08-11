import React from 'react';

export interface SlaTimelineProps {
  /** Percentage (0-100) at which the first reminder marker is placed. */
  firstReminderPct: number;
  /** Percentage (0-100) at which the second reminder marker is placed. */
  secondReminderPct: number;
  /** Target duration in minutes — used only for display labels. */
  targetMinutes: number;
  className?: string;
}

export function SlaTimeline({ firstReminderPct, secondReminderPct, targetMinutes, className }: SlaTimelineProps) {
  const first = Math.max(0, Math.min(100, firstReminderPct));
  const second = Math.max(0, Math.min(100, secondReminderPct));

  const firstMin = Math.round(targetMinutes * first / 100);
  const secondMin = Math.round(targetMinutes * second / 100);

  return (
    <figure
      className={className}
      aria-label={`SLA timeline: ${targetMinutes}-minute target with reminders at ${first}% and ${second}%`}
      style={{ margin: 0 }}
    >
      {/* Track */}
      <div
        aria-hidden="true"
        style={{
          position: 'relative',
          height: 32,
          background: 'var(--color-surface-2, #f3f4f6)',
          borderRadius: 6,
          overflow: 'hidden',
          border: '1px solid var(--color-border, #e5e7eb)',
        }}
      >
        {/* Healthy zone: 0 to first reminder */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: `${first}%`,
            height: '100%',
            background: 'var(--color-success-surface, #d1fae5)',
          }}
        />
        {/* Warning zone: first to second reminder */}
        <div
          style={{
            position: 'absolute',
            left: `${first}%`,
            width: `${second - first}%`,
            height: '100%',
            background: 'var(--color-warning-surface, #fef3c7)',
          }}
        />
        {/* Critical zone: second to 100% */}
        <div
          style={{
            position: 'absolute',
            left: `${second}%`,
            right: 0,
            height: '100%',
            background: 'var(--color-error-surface, #fee2e2)',
          }}
        />

        {/* First reminder marker */}
        <div
          style={{
            position: 'absolute',
            left: `${first}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'var(--color-warning, #f59e0b)',
            zIndex: 1,
          }}
        />
        {/* Second reminder marker */}
        <div
          style={{
            position: 'absolute',
            left: `${second}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'var(--color-error, #ef4444)',
            zIndex: 1,
          }}
        />
        {/* Target marker at 100% */}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: 'var(--color-fg-primary, #111827)',
            zIndex: 1,
          }}
        />
      </div>

      {/* Labels */}
      <figcaption
        aria-hidden="true"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 6,
          fontSize: 11,
          color: 'var(--color-fg-secondary, #6b7280)',
          position: 'relative',
        }}
      >
        <span>0 min</span>
        {/* First reminder label */}
        <span
          style={{
            position: 'absolute',
            left: `${first}%`,
            transform: 'translateX(-50%)',
            color: 'var(--color-warning, #b45309)',
            fontWeight: 500,
          }}
        >
          {firstMin}m ({first}%)
        </span>
        {/* Second reminder label */}
        <span
          style={{
            position: 'absolute',
            left: `${second}%`,
            transform: 'translateX(-50%)',
            color: 'var(--color-error, #dc2626)',
            fontWeight: 500,
          }}
        >
          {secondMin}m ({second}%)
        </span>
        <span style={{ fontWeight: 500 }}>{targetMinutes} min</span>
      </figcaption>

      {/* Screen-reader description */}
      <p className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        Timeline shows three zones: healthy from 0 to {firstMin} minutes, warning from {firstMin} to {secondMin} minutes, and critical from {secondMin} to {targetMinutes} minutes.
      </p>
    </figure>
  );
}
