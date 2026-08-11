'use client';

/**
 * RunStatePill — displays current run state with actionable messaging (WO-078 AC-6).
 *
 * States: idle | running | success | truncated | timeout | error
 * Announces transitions via aria-live region.
 */

import React from 'react';
import { getErrorCopy } from '../../../lib/api/reporting/types';

export type RunState = 'idle' | 'running' | 'success' | 'truncated' | 'timeout' | 'error';

interface RunStatePillProps {
  state:      RunState;
  rowCount?:  number;
  errorCode?: string;
}

const STATE_CONFIG: Record<RunState, { label: string; bg: string; fg: string; icon: string }> = {
  idle:      { label: 'Ready',     bg: 'var(--color-surface)',              fg: 'var(--color-text-secondary)', icon: '○' },
  running:   { label: 'Running…',  bg: 'var(--color-primary-subtle)',       fg: 'var(--color-primary)',        icon: '◌' },
  success:   { label: 'Complete',  bg: 'var(--color-success-subtle, #f0fdf4)', fg: 'var(--color-success, #16a34a)', icon: '✓' },
  truncated: { label: 'Truncated', bg: 'var(--color-warning-subtle, #fffbeb)', fg: 'var(--color-warning, #b45309)', icon: '⚠' },
  timeout:   { label: 'Timed out', bg: 'var(--color-error-subtle, #fef2f2)',  fg: 'var(--color-error, #dc2626)',   icon: '⏱' },
  error:     { label: 'Error',     bg: 'var(--color-error-subtle, #fef2f2)',  fg: 'var(--color-error, #dc2626)',   icon: '✕' },
};

export function RunStatePill({ state, rowCount, errorCode }: RunStatePillProps) {
  const cfg = STATE_CONFIG[state];

  let detail: string | null = null;
  if (state === 'success' && rowCount !== undefined) {
    detail = `${rowCount.toLocaleString()} row${rowCount !== 1 ? 's' : ''}`;
  } else if (state === 'timeout' && errorCode) {
    detail = getErrorCopy(errorCode, 'Query timed out. Try narrowing the date range.');
  } else if (state === 'error' && errorCode) {
    detail = getErrorCopy(errorCode);
  } else if (state === 'truncated') {
    detail = `${rowCount?.toLocaleString() ?? ''} rows (truncated)`;
  }

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          '0.375rem',
        padding:      '0.25rem 0.75rem',
        borderRadius: '9999px',
        background:   cfg.bg,
        color:        cfg.fg,
        fontSize:     '0.8125rem',
        fontWeight:   600,
        border:       `1px solid currentColor`,
      }}
    >
      <span aria-hidden="true">{cfg.icon}</span>
      <span>{cfg.label}</span>
      {detail && (
        <span style={{ fontWeight: 400, marginLeft: '0.25rem' }}>— {detail}</span>
      )}
    </span>
  );
}
