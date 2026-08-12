/**
 * SLA state metadata — token, icon name and label for each SLA state.
 *
 * Consumed by SlaCountdown and SlaHint. Both components must communicate
 * state via colour AND icon AND text label (never colour alone).
 *
 * This module is the single source of truth for SLA display semantics.
 * WOREF-017 establishes the design-token contract; these values fulfil it.
 */

export type SlaState = 'running' | 'warning' | 'paused' | 'breached';

export interface SlaStateMeta {
  /** CSS custom-property name for the state colour */
  colorVar: string;
  /** Background colour for the pill */
  bgVar: string;
  /** Icon identifier for the Icon component */
  iconName: 'clock' | 'clock-warning' | 'pause-circle' | 'alert-circle';
  /** Human-readable state label — always present alongside colour */
  label: string;
  /** aria-live announcement text for state entry */
  announcement: string;
}

export const slaStateMeta = {
  running: {
    colorVar: '--sla-running-fg',
    bgVar: '--sla-running-bg',
    iconName: 'clock',
    label: 'On Track',
    announcement: '',
  },
  warning: {
    colorVar: '--sla-warning-fg',
    bgVar: '--sla-warning-bg',
    iconName: 'clock-warning',
    label: 'At risk',
    announcement: 'SLA at risk',
  },
  paused: {
    colorVar: '--sla-paused-fg',
    bgVar: '--sla-paused-bg',
    iconName: 'pause-circle',
    label: 'Paused',
    announcement: '',
  },
  breached: {
    colorVar: '--sla-breached-fg',
    bgVar: '--sla-breached-bg',
    iconName: 'alert-circle',
    label: 'Breached',
    announcement: 'SLA breached',
  },
} as const satisfies Record<SlaState, SlaStateMeta>;

/** CSS custom property defaults (light theme). Include in a global stylesheet. */
export const SLA_CSS_VARS = `
  --sla-running-fg: #0e7a3c;
  --sla-running-bg: #ecfdf3;
  --sla-warning-fg: #92400e;
  --sla-warning-bg: #fffbeb;
  --sla-paused-fg: #374151;
  --sla-paused-bg: #f3f4f6;
  --sla-breached-fg: #991b1b;
  --sla-breached-bg: #fef2f2;
`;
