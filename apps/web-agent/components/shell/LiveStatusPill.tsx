'use client';

import React from 'react';
import { useRealtimeStatusStore, type RealtimeStatus } from '@/lib/stores/realtimeStatusStore';

const statusConfig: Record<
  RealtimeStatus,
  { label: string; icon: string; ariaLabel: string; color: string; bg: string }
> = {
  connected: {
    label: 'Live',
    icon: '●',
    ariaLabel: 'Realtime connection: connected',
    color: 'var(--color-sla-running-text, #166534)',
    bg: 'var(--color-sla-running-bg, #dcfce7)',
  },
  reconnecting: {
    label: 'Reconnecting',
    icon: '↻',
    ariaLabel: 'Realtime connection: reconnecting',
    color: 'var(--color-sla-warning-text, #92400e)',
    bg: 'var(--color-sla-warning-bg, #fef3c7)',
  },
  offline: {
    label: 'Offline',
    icon: '○',
    ariaLabel: 'Realtime connection: offline',
    color: 'var(--color-sla-breached-text, #991b1b)',
    bg: 'var(--color-sla-breached-bg, #fee2e2)',
  },
};

export function LiveStatusPill() {
  const status = useRealtimeStatusStore(s => s.status);
  const config = statusConfig[status];

  return (
    <span
      role="status"
      aria-label={config.ariaLabel}
      aria-live="polite"
      data-testid="live-status-pill"
      data-status={status}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding: '0.2rem 0.6rem',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        color: config.color,
        background: config.bg,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">{config.icon}</span>
      <span>{config.label}</span>
    </span>
  );
}
