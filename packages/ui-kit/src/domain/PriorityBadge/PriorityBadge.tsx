import React from 'react';
import { priorityMeta, type Priority } from '../../tokens/priority-meta';

export interface PriorityBadgeProps {
  priority: Priority;
  /** Show full label instead of short label ("Critical" vs "P1"). Default: false. */
  verbose?: boolean;
  className?: string;
}

const badgeStyles: Record<Priority, React.CSSProperties> = {
  p1: { color: 'var(--color-priority-p1-text, #7f1d1d)', background: 'var(--color-priority-p1-bg, #fee2e2)' },
  p2: { color: 'var(--color-priority-p2-text, #7c2d12)', background: 'var(--color-priority-p2-bg, #ffedd5)' },
  p3: { color: 'var(--color-priority-p3-text, #713f12)', background: 'var(--color-priority-p3-bg, #fef9c3)' },
  p4: { color: 'var(--color-priority-p4-text, #1e3a5f)', background: 'var(--color-priority-p4-bg, #dbeafe)' },
};

export function PriorityBadge({ priority, verbose = false, className }: PriorityBadgeProps) {
  const meta = priorityMeta[priority];
  return (
    <span
      role="img"
      aria-label={meta.ariaLabel}
      data-testid="priority-badge"
      data-priority={priority}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding: '0.125rem 0.5rem',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 700,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
        ...badgeStyles[priority],
      }}
    >
      {verbose ? meta.label : meta.shortLabel}
    </span>
  );
}
