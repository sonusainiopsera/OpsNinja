'use client';

/**
 * RowLimitNote — always-visible preview/export cap notice (WO-078 AC-5).
 *
 * Shows:
 *  - Preview cap (default 1 000 rows)
 *  - CSV export cap (500 000 rows)
 *  - Read-replica freshness notice
 *  - Truncation warning when results are cut
 */

import React from 'react';

interface RowLimitNoteProps {
  previewCap?:  number;
  exportCap?:   number;
  truncated?:   boolean;
  dataAsOf?:    string | null;
  lagSeconds?:  number;
  /** Threshold above which a "stale" badge appears (default: 30s) */
  staleThresholdSeconds?: number;
}

const STALE_THRESHOLD_DEFAULT = 30;

export function RowLimitNote({
  previewCap  = 1_000,
  exportCap   = 500_000,
  truncated   = false,
  dataAsOf,
  lagSeconds,
  staleThresholdSeconds = STALE_THRESHOLD_DEFAULT,
}: RowLimitNoteProps) {
  const isStale = lagSeconds !== undefined && lagSeconds > staleThresholdSeconds;

  return (
    <div
      role="note"
      aria-label="Data limits and freshness"
      style={{
        padding:      '0.625rem 0.875rem',
        borderRadius: 'var(--radius-md, 6px)',
        border:       `1px solid ${truncated ? 'var(--color-warning, #f59e0b)' : 'var(--color-border)'}`,
        background:   truncated ? 'var(--color-warning-subtle, #fffbeb)' : 'var(--color-surface-raised, var(--color-surface))',
        fontSize:     '0.8125rem',
        color:        'var(--color-text-secondary)',
        display:      'flex',
        flexWrap:     'wrap',
        gap:          '0.75rem',
        alignItems:   'center',
      }}
    >
      {truncated && (
        <span
          role="alert"
          style={{ color: 'var(--color-warning, #b45309)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
        >
          <span aria-hidden="true">⚠</span>
          Preview truncated at {previewCap.toLocaleString()} rows.
          Export to CSV for the full {exportCap.toLocaleString()}-row dataset.
        </span>
      )}
      {!truncated && (
        <span>
          Preview limited to <strong>{previewCap.toLocaleString()}</strong> rows.{' '}
          CSV export up to <strong>{exportCap.toLocaleString()}</strong> rows.
        </span>
      )}
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        <span aria-hidden="true">⏱</span>
        Results from read replica.
        {dataAsOf && (
          <span>
            {' '}Data as of{' '}
            <time dateTime={dataAsOf}>
              {new Date(dataAsOf).toLocaleString()}
            </time>
          </span>
        )}
        {isStale && (
          <span
            role="status"
            aria-live="polite"
            style={{
              display:      'inline-flex',
              alignItems:   'center',
              gap:          '0.2rem',
              padding:      '0.1rem 0.5rem',
              borderRadius: '9999px',
              background:   'var(--color-warning, #f59e0b)',
              color:        '#fff',
              fontSize:     '0.7rem',
              fontWeight:   700,
            }}
          >
            STALE
          </span>
        )}
      </span>
    </div>
  );
}
