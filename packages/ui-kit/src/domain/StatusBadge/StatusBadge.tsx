import React from 'react';
import { statusMeta, type TicketStatus } from '../../tokens/status-meta';

export interface StatusBadgeProps {
  status: TicketStatus;
  className?: string;
}

const badgeStyles: Record<TicketStatus, React.CSSProperties> = {
  open:        { color: 'var(--color-status-open-text,        #1e40af)', background: 'var(--color-status-open-bg,        #dbeafe)' },
  in_progress: { color: 'var(--color-status-in-progress-text, #166534)', background: 'var(--color-status-in-progress-bg, #dcfce7)' },
  pending:     { color: 'var(--color-status-pending-text,     #713f12)', background: 'var(--color-status-pending-bg,     #fef9c3)' },
  resolved:    { color: 'var(--color-status-resolved-text,    #065f46)', background: 'var(--color-status-resolved-bg,    #d1fae5)' },
  closed:      { color: 'var(--color-status-closed-text,      #374151)', background: 'var(--color-status-closed-bg,      #f3f4f6)' },
};

const iconFallback: Record<TicketStatus, string> = {
  open:        '●',
  in_progress: '▶',
  pending:     '⏸',
  resolved:    '✓',
  closed:      '✕',
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const meta = statusMeta[status];
  return (
    <span
      role="img"
      aria-label={`Status: ${meta.label}`}
      data-testid="status-badge"
      data-status={status}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding: '0.125rem 0.5rem',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        ...badgeStyles[status],
      }}
    >
      <span aria-hidden="true" data-icon={meta.iconName}>
        {iconFallback[status]}
      </span>
      <span>{meta.label}</span>
    </span>
  );
}
