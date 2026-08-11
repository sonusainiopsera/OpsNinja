/**
 * PriorityBadge — P1 through P4 ticket priority indicator.
 *
 * Each priority has distinct token colours AND a distinct text label.
 * Colour-blind safe: the label is always visible (never hidden by aria-label alone).
 * Passes WCAG 2.1 AA contrast in both light and dark themes.
 */

import React from 'react';

export type Priority = 'P1' | 'P2' | 'P3' | 'P4';

interface PriorityConfig {
  label: string;
  /** CSS custom property for text/border colour */
  colorVar: string;
  /** CSS custom property for background */
  bgVar: string;
  /** Accessible description */
  description: string;
}

const PRIORITY_CONFIG = {
  P1: { label: 'P1', colorVar: '--priority-p1-fg', bgVar: '--priority-p1-bg', description: 'Critical' },
  P2: { label: 'P2', colorVar: '--priority-p2-fg', bgVar: '--priority-p2-bg', description: 'High' },
  P3: { label: 'P3', colorVar: '--priority-p3-fg', bgVar: '--priority-p3-bg', description: 'Medium' },
  P4: { label: 'P4', colorVar: '--priority-p4-fg', bgVar: '--priority-p4-bg', description: 'Low' },
} as const satisfies Record<Priority, PriorityConfig>;

export const PRIORITY_CSS_VARS = `
  --priority-p1-fg: #7f1d1d; --priority-p1-bg: #fef2f2;
  --priority-p2-fg: #78350f; --priority-p2-bg: #fff7ed;
  --priority-p3-fg: #1e3a5f; --priority-p3-bg: #eff6ff;
  --priority-p4-fg: #14532d; --priority-p4-bg: #f0fdf4;
`;

export interface PriorityBadgeProps {
  priority: Priority;
  className?: string;
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority];
  return (
    <span
      className={className}
      aria-label={`Priority: ${config.description}`}
      data-priority={priority}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 6px',
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.05em',
        background: `var(${config.bgVar})`,
        color: `var(${config.colorVar})`,
        userSelect: 'none',
      }}
    >
      {config.label}
    </span>
  );
}
