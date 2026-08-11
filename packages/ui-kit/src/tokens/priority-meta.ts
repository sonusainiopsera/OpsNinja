export type Priority = 'p1' | 'p2' | 'p3' | 'p4';

export interface PriorityMeta {
  readonly label: string;
  readonly shortLabel: string;
  readonly token: string;
  readonly textToken: string;
  readonly ariaLabel: string;
}

export const priorityMeta: Record<Priority, PriorityMeta> = {
  p1: {
    label: 'Critical',
    shortLabel: 'P1',
    token: 'color.priority.p1.bg',
    textToken: 'color.priority.p1.text',
    ariaLabel: 'Priority 1 Critical',
  },
  p2: {
    label: 'High',
    shortLabel: 'P2',
    token: 'color.priority.p2.bg',
    textToken: 'color.priority.p2.text',
    ariaLabel: 'Priority 2 High',
  },
  p3: {
    label: 'Medium',
    shortLabel: 'P3',
    token: 'color.priority.p3.bg',
    textToken: 'color.priority.p3.text',
    ariaLabel: 'Priority 3 Medium',
  },
  p4: {
    label: 'Low',
    shortLabel: 'P4',
    token: 'color.priority.p4.bg',
    textToken: 'color.priority.p4.text',
    ariaLabel: 'Priority 4 Low',
  },
} as const;
