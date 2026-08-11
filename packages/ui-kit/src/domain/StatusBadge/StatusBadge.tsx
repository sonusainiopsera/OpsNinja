/**
 * StatusBadge — ticket lifecycle status indicator.
 *
 * Covers the full ticket lifecycle: open → in_progress → pending_customer →
 * resolved → closed. Each status has distinct colour + text label.
 */

import React from 'react';

export type TicketStatus = 'open' | 'in_progress' | 'pending_customer' | 'resolved' | 'closed';

interface StatusConfig {
  label: string;
  colorVar: string;
  bgVar: string;
}

const STATUS_CONFIG = {
  open: { label: 'Open', colorVar: '--status-open-fg', bgVar: '--status-open-bg' },
  in_progress: { label: 'In Progress', colorVar: '--status-progress-fg', bgVar: '--status-progress-bg' },
  pending_customer: { label: 'Pending Customer', colorVar: '--status-pending-fg', bgVar: '--status-pending-bg' },
  resolved: { label: 'Resolved', colorVar: '--status-resolved-fg', bgVar: '--status-resolved-bg' },
  closed: { label: 'Closed', colorVar: '--status-closed-fg', bgVar: '--status-closed-bg' },
} as const satisfies Record<TicketStatus, StatusConfig>;

export const STATUS_CSS_VARS = `
  --status-open-fg: #1e3a5f; --status-open-bg: #eff6ff;
  --status-progress-fg: #78350f; --status-progress-bg: #fff7ed;
  --status-pending-fg: #4c1d95; --status-pending-bg: #f5f3ff;
  --status-resolved-fg: #14532d; --status-resolved-bg: #f0fdf4;
  --status-closed-fg: #374151; --status-closed-bg: #f9fafb;
`;

export interface StatusBadgeProps {
  status: TicketStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={className}
      aria-label={`Status: ${config.label}`}
      data-status={status}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 8px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 500,
        background: `var(${config.bgVar})`,
        color: `var(${config.colorVar})`,
        userSelect: 'none',
      }}
    >
      {config.label}
    </span>
  );
}
