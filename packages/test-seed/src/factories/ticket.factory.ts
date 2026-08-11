/**
 * Ticket factory — pure functional, no DB access.
 *
 * Generates tickets spanning multiple monthly partitions.
 * Deliberately reuses subjects from the collision matrix across tenants.
 */

import type { NewTicket } from '@opsninja/db';
import { SeededRandom } from '../prng';
import { PartitionWindow, spreadAcrossPartitions } from '../partition-dates';
import { COLLISION_MATRIX } from '../collision-matrix';

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export const TICKET_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;

const UNIQUE_SUBJECTS = [
  'Login button unresponsive after update',
  'Report generation timeout',
  'Export CSV contains incorrect encoding',
  'Notification email not delivered',
  'Dashboard widget shows stale data',
  'API rate limit exceeded — integration failure',
  'File attachment exceeds permitted size',
  'User unable to reset password',
  'Missing data in monthly summary',
  'Two-factor auth loop on mobile',
  'Performance degradation after migration',
  'Webhook signature validation failure',
  'Bulk import ignores first row',
  'Session expires prematurely',
  'Print view renders incorrectly',
];

const AI_SUMMARY_TEMPLATES = [
  'User reported login issue. Root cause identified as expired session token. Resolved by forcing re-authentication.',
  'Performance ticket. Query optimization reduced response time by 60%. Monitoring in place.',
  null,
  null,
  null,
];

export interface TicketSeed {
  id: string;
  tenantId: string;
  organizationId: string;
  record: NewTicket;
}

export function buildTickets(
  rng: SeededRandom,
  tenantId: string,
  orgIds: string[],
  userIds: string[],
  count: number,
  partitionWindow: PartitionWindow,
): TicketSeed[] {
  const tickets: TicketSeed[] = [];
  const sharedSubjects = COLLISION_MATRIX.sharedTicketSubjects;
  const dates = spreadAcrossPartitions(count, partitionWindow, () => rng.next());

  for (let i = 0; i < count; i++) {
    const r = rng.child(i + 300);
    const id = r.uuid();
    const orgId = rng.pick(orgIds);
    const createdAt = dates[i % dates.length]!;
    const status = rng.pick(TICKET_STATUSES);

    // First N tickets use shared subjects (collision testing)
    const subject = i < sharedSubjects.length
      ? sharedSubjects[i]!
      : rng.pick(UNIQUE_SUBJECTS);

    const assigneeId = rng.nextBool(0.8) && userIds.length > 0
      ? rng.pick(userIds)
      : null;

    const resolvedAt = (status === 'resolved' || status === 'closed')
      ? new Date(createdAt.getTime() + rng.nextIntRange(1, 72) * 60 * 60 * 1000)
      : null;

    tickets.push({
      id,
      tenantId,
      organizationId: orgId,
      record: {
        id,
        tenantId,
        organizationId: orgId,
        subject,
        status,
        priority: rng.pick(TICKET_PRIORITIES),
        assigneeId,
        aiSummary: rng.pick(AI_SUMMARY_TEMPLATES),
        affectedAreaTags: rng.nextBool(0.3)
          ? { areas: ['authentication', 'reporting'].slice(0, rng.nextIntRange(1, 2)) }
          : null,
        createdAt,
        updatedAt: new Date(createdAt.getTime() + rng.nextInt(7200) * 1000),
        resolvedAt,
      },
    });
  }

  return tickets;
}
