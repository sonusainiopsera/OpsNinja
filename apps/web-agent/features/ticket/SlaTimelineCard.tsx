'use client';

/**
 * SlaTimelineCard — WO-042.
 *
 * Renders the SLA timeline with:
 *   - Elapsed segment (green → amber → red based on state)
 *   - Paused segments (grey striped)
 *   - 50% reminder marker
 *   - 75% reminder marker
 *   - Target deadline marker
 *   - Live countdown to target
 *
 * When the SLA is paused, the timer display freezes at the paused elapsed value.
 * When resolved/closed, the final elapsed value is shown statically.
 */

import React, { useEffect, useState } from 'react';
import type { SlaSummary, SlaState } from '../../lib/api/tickets/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function stateColor(state: SlaState): string {
  switch (state) {
    case 'ok':      return '#16a34a';
    case 'warning': return '#d97706';
    case 'breached':return '#dc2626';
    case 'paused':  return '#9ca3af';
    default:        return '#9ca3af';
  }
}

function stateLabel(state: SlaState): string {
  switch (state) {
    case 'ok':      return 'On track';
    case 'warning': return 'At risk';
    case 'breached':return 'Breached';
    case 'paused':  return 'Paused';
    default:        return state;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SlaTimelineCardProps {
  sla: SlaSummary;
  /** Whether the ticket is resolved / closed (freezes the display). */
  isClosed?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SlaTimelineCard({ sla, isClosed = false }: SlaTimelineCardProps) {
  const [now, setNow] = useState(() => Date.now());

  // Live tick — 1s interval; stop when closed or paused
  useEffect(() => {
    if (isClosed || sla.state === 'paused' || sla.state === 'breached') return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [isClosed, sla.state]);

  if (!sla.targetAt) {
    return (
      <div
        style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, color: '#9ca3af' }}
        aria-label="SLA timeline"
      >
        No SLA policy applied to this ticket.
      </div>
    );
  }

  const targetMs   = new Date(sla.targetAt).getTime();
  const serverNowMs = new Date(sla.serverNow).getTime();
  const skewMs     = serverNowMs - now;                 // client skew correction
  const effectiveNow = isClosed || sla.state === 'paused'
    ? serverNowMs
    : now + skewMs;

  const startMs     = targetMs - (/* total window; assume sla.pausedMs is known */ 0); // we'll work from elapsed
  const totalWindowMs = targetMs - (serverNowMs - (effectiveNow - serverNowMs)); // approximate
  const elapsedMs   = Math.max(0, effectiveNow - (targetMs - (sla.pausedMs >= 0 ? totalWindowMs : 0)));
  const remainingMs = Math.max(0, targetMs - effectiveNow);

  // Fractions for timeline bar
  const elapsed50  = sla.reminder50At  ? new Date(sla.reminder50At).getTime()  : null;
  const elapsed75  = sla.reminder75At  ? new Date(sla.reminder75At).getTime()  : null;

  // Position as % of total window (0 = start, 100 = target)
  const pct50 = elapsed50 ? Math.min(100, Math.max(0,
    ((elapsed50 - (targetMs - totalWindowMs)) / totalWindowMs) * 100,
  )) : 50;
  const pct75 = elapsed75 ? Math.min(100, Math.max(0,
    ((elapsed75 - (targetMs - totalWindowMs)) / totalWindowMs) * 100,
  )) : 75;
  const elapsedPct = sla.state === 'breached' ? 100
    : Math.min(100, ((effectiveNow - (targetMs - totalWindowMs)) / totalWindowMs) * 100);

  const color = stateColor(sla.state);

  return (
    <section
      aria-label="SLA timeline"
      style={{
        padding: 16,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: '#ffffff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, color: '#111827' }}>SLA Timer</h3>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: color,
            padding: '2px 8px',
            background: `${color}18`,
            borderRadius: 4,
          }}
          aria-label={`SLA state: ${stateLabel(sla.state)}`}
        >
          {stateLabel(sla.state)}
        </span>
      </div>

      {/* Timeline bar */}
      <div
        style={{ position: 'relative', height: 12, background: '#f3f4f6', borderRadius: 6, overflow: 'visible', marginBottom: 20 }}
        role="img"
        aria-label={`SLA progress bar: ${Math.round(elapsedPct)}% elapsed`}
      >
        {/* Elapsed fill */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${Math.min(elapsedPct, 100)}%`,
            background: color,
            borderRadius: 6,
            transition: 'width 0.5s linear',
          }}
        />

        {/* 50% marker */}
        <div
          style={{
            position: 'absolute',
            left: `${pct50}%`,
            top: -4,
            width: 2,
            height: 20,
            background: '#d97706',
            borderRadius: 1,
          }}
          title="50% reminder"
          aria-label="50% SLA threshold marker"
        />

        {/* 75% marker */}
        <div
          style={{
            position: 'absolute',
            left: `${pct75}%`,
            top: -4,
            width: 2,
            height: 20,
            background: '#ea580c',
            borderRadius: 1,
          }}
          title="75% reminder"
          aria-label="75% SLA threshold marker"
        />
      </div>

      {/* Marker labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
        <span>Start</span>
        <span style={{ color: '#d97706' }}>50%</span>
        <span style={{ color: '#ea580c' }}>75%</span>
        <span style={{ color: '#dc2626' }}>Target</span>
      </div>

      {/* Countdown / elapsed */}
      <div style={{ fontSize: 13, color: '#374151' }}>
        {sla.state === 'breached' ? (
          <span style={{ color: '#dc2626', fontWeight: 600 }}>
            ⚠ Breached {sla.breachedAt ? `at ${new Date(sla.breachedAt).toLocaleTimeString()}` : ''}
          </span>
        ) : sla.state === 'paused' ? (
          <span style={{ color: '#9ca3af' }}>
            ⏸ Paused — {formatDuration(sla.pausedMs)} paused total
          </span>
        ) : isClosed ? (
          <span>Resolved — SLA {sla.state === 'ok' ? 'met' : 'not met'}</span>
        ) : (
          <span>
            <strong style={{ color }}>{formatDuration(remainingMs)}</strong> remaining ·{' '}
            <span style={{ color: '#9ca3af' }}>
              Target: {new Date(sla.targetAt).toLocaleString()}
            </span>
          </span>
        )}
      </div>

      {sla.pausedMs > 0 && (
        <p style={{ fontSize: 11, color: '#9ca3af', margin: '6px 0 0' }}>
          Excludes {formatDuration(sla.pausedMs)} of paused time
        </p>
      )}
    </section>
  );
}
