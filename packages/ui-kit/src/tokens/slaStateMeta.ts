import type { SemanticRole } from './semantic.js';

export type SlaState = 'running' | 'warning' | 'paused' | 'breached';

export interface SlaStateDescriptor {
  readonly token: SemanticRole;
  readonly iconName: string;
  readonly label: string;
  readonly patternClass: string;
}

export const slaStateMeta: Record<SlaState, SlaStateDescriptor> = {
  running: {
    token: 'sla-running',
    iconName: 'clock',
    label: 'Running',
    patternClass: 'sla-pattern-solid',
  },
  warning: {
    token: 'sla-warning',
    iconName: 'clock-alert',
    label: 'Warning',
    patternClass: 'sla-pattern-dashed',
  },
  paused: {
    token: 'sla-paused',
    iconName: 'clock-pause',
    label: 'Paused',
    patternClass: 'sla-pattern-dotted',
  },
  breached: {
    token: 'sla-breached',
    iconName: 'clock-x',
    label: 'Breached',
    patternClass: 'sla-pattern-striped',
  },
} as const;

export const SLA_STATES: readonly SlaState[] = [
  'running',
  'warning',
  'paused',
  'breached',
] as const;
