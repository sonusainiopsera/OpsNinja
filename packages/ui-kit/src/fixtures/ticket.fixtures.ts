import type { Priority } from '../tokens/priority-meta';
import type { TicketStatus } from '../tokens/status-meta';
import type { SlaState } from '../tokens/sla-state-meta';

export interface TicketFixture {
  id: string;
  title: string;
  status: TicketStatus;
  priority: Priority;
  orgName: string;
  jiraKey: string;
  slaState: SlaState;
  slaTargetAt: string;
}

export const ticketFixtures: TicketFixture[] = [
  {
    id: 'TKT-001',
    title: 'Login page throws 500 for enterprise SSO users',
    status: 'open',
    priority: 'p1',
    orgName: 'Acme Corp',
    jiraKey: 'ENG-4421',
    slaState: 'warning',
    slaTargetAt: '2024-01-15T10:30:00.000Z',
  },
  {
    id: 'TKT-002',
    title: 'Dashboard fails to load after timezone update',
    status: 'in_progress',
    priority: 'p2',
    orgName: 'Beta Systems',
    jiraKey: 'ENG-4389',
    slaState: 'running',
    slaTargetAt: '2024-01-15T16:00:00.000Z',
  },
  {
    id: 'TKT-003',
    title: 'Export CSV truncates after 1000 rows',
    status: 'pending',
    priority: 'p3',
    orgName: 'Gamma Industries',
    jiraKey: 'ENG-4312',
    slaState: 'paused',
    slaTargetAt: '2024-01-15T18:00:00.000Z',
  },
  {
    id: 'TKT-004',
    title: 'Webhook events not firing for EU region',
    status: 'resolved',
    priority: 'p2',
    orgName: 'Delta Logistics',
    jiraKey: 'ENG-4280',
    slaState: 'breached',
    slaTargetAt: '2024-01-15T08:00:00.000Z',
  },
];
