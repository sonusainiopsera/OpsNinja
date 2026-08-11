'use client';

/**
 * SchedulerHealthPill — shows SLA scheduler health in the page header.
 *
 * Always conveys state via icon + text label, never colour alone (WCAG 1.4.1).
 * Shows 'unknown' when the endpoint errors, never a false 'healthy'.
 */

import React from 'react';
import { useSchedulerHealth } from '../../../../lib/api/sla/hooks';
import type { SchedulerHealthStatus } from '../../../../lib/api/sla/types';

const STATUS_CONFIG: Record<
  SchedulerHealthStatus,
  { label: string; icon: string; ariaLabel: string; bg: string; fg: string }
> = {
  healthy: {
    label: 'Scheduler healthy',
    icon: '✓',
    ariaLabel: 'SLA scheduler is healthy',
    bg: 'var(--color-success-surface, #d1fae5)',
    fg: 'var(--color-success, #065f46)',
  },
  degraded: {
    label: 'Scheduler degraded',
    icon: '!',
    ariaLabel: 'SLA scheduler is degraded — check lag',
    bg: 'var(--color-warning-surface, #fef3c7)',
    fg: 'var(--color-warning, #92400e)',
  },
  unknown: {
    label: 'Scheduler unknown',
    icon: '?',
    ariaLabel: 'SLA scheduler status is unknown',
    bg: 'var(--color-surface-2, #f3f4f6)',
    fg: 'var(--color-fg-secondary, #6b7280)',
  },
};

export function SchedulerHealthPill() {
  const { data, isError } = useSchedulerHealth();

  // Fail to unknown — never show a false healthy state
  const status: SchedulerHealthStatus =
    isError || !data ? 'unknown' : data.status;
  const cfg = STATUS_CONFIG[status];

  return (
    <span
      role="status"
      aria-label={cfg.ariaLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 10px',
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 500,
        background: cfg.bg,
        color: cfg.fg,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 10, fontWeight: 700, lineHeight: 1 }}>
        {cfg.icon}
      </span>
      {cfg.label}
      {data?.lagMs != null && status === 'healthy' && (
        <span style={{ opacity: 0.7, fontWeight: 400 }}>· {data.lagMs}ms</span>
      )}
    </span>
  );
}
