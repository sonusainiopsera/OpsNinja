'use client';

/**
 * MetricTile — single stat tile for the health strip (WO-058).
 *
 * Renders a labelled numeric metric with optional unit, severity colour,
 * and a stale badge when cachedAt is outside the expected freshness window.
 * Uses no colour-only encoding: icons and text labels always accompany colour.
 */

import React from 'react';

export type MetricSeverity = 'ok' | 'warning' | 'critical' | 'unknown';

interface Props {
  label: string;
  value: string | number | null;
  unit?: string;
  severity?: MetricSeverity;
  stale?: boolean;
  cachedAt?: string;
  loading?: boolean;
  description?: string;
}

const SEVERITY_STYLE: Record<MetricSeverity, { bg: string; fg: string; icon: string }> = {
  ok:       { bg: 'var(--color-success-bg, #f0fdf4)',  fg: 'var(--color-success,  #16a34a)', icon: '✓' },
  warning:  { bg: 'var(--color-warning-bg, #fffbeb)',  fg: 'var(--color-warning,  #d97706)', icon: '⚠' },
  critical: { bg: 'var(--color-error-bg,   #fef2f2)',  fg: 'var(--color-error,    #dc2626)', icon: '✗' },
  unknown:  { bg: 'var(--color-neutral-bg, #f9fafb)',  fg: 'var(--color-fg-muted, #6b7280)', icon: '?' },
};

export function MetricTile({
  label,
  value,
  unit,
  severity = 'unknown',
  stale = false,
  cachedAt,
  loading = false,
  description,
}: Props) {
  const style = SEVERITY_STYLE[severity];

  const displayValue = loading ? '…' : (value === null || value === undefined ? '—' : value);
  const ariaLabel = `${label}: ${displayValue}${unit ? ' ' + unit : ''}${stale ? ', stale data' : ''}`;

  return (
    <div
      role="region"
      aria-label={ariaLabel}
      title={description}
      style={{
        background: style.bg,
        borderRadius: 8,
        padding: '16px 20px',
        minWidth: 140,
        flex: 1,
        position: 'relative',
      }}
    >
      {/* Stale badge */}
      {stale && (
        <span
          aria-label={`Stale data — cached at ${cachedAt ?? 'unknown'}`}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 6px',
            background: 'var(--color-warning-bg, #fffbeb)',
            color: 'var(--color-warning, #d97706)',
            border: '1px solid var(--color-warning, #d97706)',
            borderRadius: 4,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Stale
        </span>
      )}

      {/* Severity icon + label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span aria-hidden="true" style={{ color: style.fg, fontSize: 13, fontWeight: 700 }}>
          {style.icon}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>
          {label}
        </span>
      </div>

      {/* Value */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span
          aria-live="polite"
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: loading ? 'var(--color-fg-muted, #6b7280)' : style.fg,
            lineHeight: 1,
          }}
        >
          {displayValue}
        </span>
        {unit && !loading && (
          <span style={{ fontSize: 13, color: 'var(--color-fg-muted, #6b7280)' }}>{unit}</span>
        )}
      </div>
    </div>
  );
}
