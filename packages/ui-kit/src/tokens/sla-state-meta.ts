/**
 * SLA state metadata — consumed by SlaCountdown, SlaHint and audit formatters.
 *
 * Each state carries:
 *   token      – CSS custom-property reference for the state colour
 *   iconName   – icon identifier (resolved by the host application's icon set)
 *   label      – short human-readable label (never colour-only)
 *   ariaLabel  – descriptive accessible name for screen-reader announcements
 *
 * Adding a state requires updating the exhaustiveness check in SlaCountdown.
 */

export type SlaState = 'running' | 'warning' | 'paused' | 'breached';

export interface SlaStateMeta {
  readonly token: string;
  readonly iconName: string;
  readonly label: string;
  readonly ariaLabel: string;
}

export const slaStateMeta: Record<SlaState, SlaStateMeta> = {
  running: {
    token: 'color.sla.running',
    iconName: 'clock',
    label: 'On Track',
    ariaLabel: 'SLA running',
  },
  warning: {
    token: 'color.sla.warning',
    iconName: 'clock-alert',
    label: 'At Risk',
    ariaLabel: 'SLA at risk',
  },
  paused: {
    token: 'color.sla.paused',
    iconName: 'pause-circle',
    label: 'Paused',
    ariaLabel: 'SLA paused',
  },
  breached: {
    token: 'color.sla.breached',
    iconName: 'alert-triangle',
    label: 'Breached',
    ariaLabel: 'SLA breached',
  },
} as const;

/** Exhaustiveness helper – compile error when a new SlaState value is added. */
export function assertNeverSlaState(state: never): never {
  throw new Error(`Unhandled SlaState: ${String(state)}`);
}
