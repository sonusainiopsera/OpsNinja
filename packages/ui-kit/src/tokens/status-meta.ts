export type TicketStatus = 'open' | 'in_progress' | 'pending' | 'resolved' | 'closed';

export interface StatusMeta {
  readonly label: string;
  readonly token: string;
  readonly textToken: string;
  readonly iconName: string;
}

export const statusMeta: Record<TicketStatus, StatusMeta> = {
  open: {
    label: 'Open',
    token: 'color.status.open.bg',
    textToken: 'color.status.open.text',
    iconName: 'circle-dot',
  },
  in_progress: {
    label: 'In Progress',
    token: 'color.status.in-progress.bg',
    textToken: 'color.status.in-progress.text',
    iconName: 'circle-play',
  },
  pending: {
    label: 'Pending',
    token: 'color.status.pending.bg',
    textToken: 'color.status.pending.text',
    iconName: 'circle-pause',
  },
  resolved: {
    label: 'Resolved',
    token: 'color.status.resolved.bg',
    textToken: 'color.status.resolved.text',
    iconName: 'circle-check',
  },
  closed: {
    label: 'Closed',
    token: 'color.status.closed.bg',
    textToken: 'color.status.closed.text',
    iconName: 'circle-x',
  },
} as const;
