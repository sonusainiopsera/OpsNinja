'use client';

/**
 * KpiGrid — six KPI summary cards (WO-070, AC1, AC2, AC10).
 *
 * Renders: Active P1, Active P2, Open Total, Running SLAs,
 *          Approaching Breach, 7-day CSAT.
 *
 * Each card exposes an accessible name + numeric value so screen readers
 * can navigate the data without seeing the visual layout.
 */

import React from 'react';
import type { DashboardKpis } from '../../../lib/api/dashboard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KpiCardDef {
  id: keyof DashboardKpis;
  label: string;
  format: (v: number) => string;
  /** CSS custom property for the accent colour. */
  accentVar: string;
  /** true if the KPI represents a concerning high count. */
  alertWhen?: (v: number) => boolean;
}

const KPI_DEFS: KpiCardDef[] = [
  {
    id: 'activeP1',
    label: 'Active P1',
    format: (v) => String(v),
    accentVar: '--kpi-p1',
    alertWhen: (v) => v > 0,
  },
  {
    id: 'activeP2',
    label: 'Active P2',
    format: (v) => String(v),
    accentVar: '--kpi-p2',
    alertWhen: (v) => v > 2,
  },
  {
    id: 'openTotal',
    label: 'Open Tickets',
    format: (v) => String(v),
    accentVar: '--kpi-open',
  },
  {
    id: 'runningSlas',
    label: 'Running SLAs',
    format: (v) => String(v),
    accentVar: '--kpi-sla',
  },
  {
    id: 'approachingBreach',
    label: 'Approaching Breach',
    format: (v) => String(v),
    accentVar: '--kpi-breach',
    alertWhen: (v) => v > 0,
  },
  {
    id: 'csat7d',
    label: '7-Day CSAT',
    format: (v) => (v > 0 ? `${v.toFixed(1)}%` : '—'),
    accentVar: '--kpi-csat',
  },
];

// ---------------------------------------------------------------------------
// KpiCard
// ---------------------------------------------------------------------------

interface KpiCardProps {
  def: KpiCardDef;
  value: number;
  loading?: boolean;
}

function KpiCard({ def, value, loading }: KpiCardProps) {
  const isAlert = def.alertWhen ? def.alertWhen(value) : false;
  const displayValue = loading ? '—' : def.format(value);

  return (
    <article
      aria-label={`${def.label}: ${displayValue}`}
      style={{
        background: 'var(--color-bg-card, #fff)',
        border: `1px solid var(--color-border, #e5e7eb)`,
        borderRadius: 8,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--color-fg-secondary, #6b7280)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {def.label}
      </span>
      <span
        aria-live="polite"
        aria-atomic="true"
        style={{
          fontSize: 28,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: isAlert
            ? `var(${def.accentVar}, var(--color-fg-primary, #111827))`
            : 'var(--color-fg-primary, #111827)',
          lineHeight: 1.1,
        }}
      >
        {displayValue}
      </span>
      {/* Non-colour breach indicator for active P1/P2 and approaching breach */}
      {isAlert && (
        <span
          aria-hidden="true"
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: `var(${def.accentVar}, #991b1b)`,
            marginTop: 2,
          }}
        >
          ▲ Attention required
        </span>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// KpiGrid
// ---------------------------------------------------------------------------

export interface KpiGridProps {
  kpis: DashboardKpis;
  loading?: boolean;
}

export function KpiGrid({ kpis, loading }: KpiGridProps) {
  return (
    <section
      aria-label="Key performance indicators"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 12,
      }}
    >
      {KPI_DEFS.map((def) => (
        <KpiCard key={def.id} def={def} value={kpis[def.id]} loading={loading} />
      ))}
    </section>
  );
}
