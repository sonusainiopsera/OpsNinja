import type { Priority } from '../../src/domain/PriorityBadge/PriorityBadge';
import type { TicketStatus } from '../../src/domain/StatusBadge/StatusBadge';
import type { SlaState } from '../../src/slaStateMeta';

export interface TicketRow {
  id: string;
  subject: string;
  priority: Priority;
  status: TicketStatus;
  slaState: SlaState;
  orgName: string;
  jiraKey: string;
}

export const TICKET_ROWS: TicketRow[] = [
  { id: 'T-001', subject: 'Login failure', priority: 'P1', status: 'open', slaState: 'running', orgName: 'Acme Corp', jiraKey: 'OPS-101' },
  { id: 'T-002', subject: 'Slow dashboard', priority: 'P3', status: 'in_progress', slaState: 'warning', orgName: 'Globex', jiraKey: 'OPS-102' },
  { id: 'T-003', subject: 'Export error', priority: 'P2', status: 'pending_customer', slaState: 'paused', orgName: 'Springfield Nuclear', jiraKey: 'OPS-103' },
  { id: 'T-004', subject: 'Email bounce', priority: 'P4', status: 'resolved', slaState: 'breached', orgName: 'Initech', jiraKey: 'OPS-104' },
  { id: 'T-005', subject: 'Billing discrepancy', priority: 'P2', status: 'closed', slaState: 'running', orgName: 'Umbrella Corp', jiraKey: 'OPS-105' },
];
