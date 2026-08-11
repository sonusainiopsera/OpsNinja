/**
 * Pure factory for ticket comments.
 * Produces a mix of public and internal visibility.
 */

import type { SeededPrng } from '../prng';
import type { SeedTicket } from './tickets.factory';

export interface SeedComment {
  id: string;
  tenantId: string;
  ticketId: string;
  authorId: string;
  body: string;
  visibility: 'public' | 'internal';
  createdAt: Date;
  updatedAt: Date;
}

const SHORT_BODIES = [
  'Thank you for reaching out. We are investigating this issue.',
  'Can you please provide more details about the environment?',
  'This has been escalated to the on-call engineer.',
  'We have identified the root cause and are applying the fix.',
  'This is resolved in the latest deployment. Please verify.',
  'Confirmed — the issue is reproducible. Working on it.',
  'Closing as resolved. Please reopen if the issue persists.',
  'Added to the backlog for the next sprint.',
  'Waiting on customer confirmation before closing.',
  'Assigned to the platform team for investigation.',
];

const INTERNAL_BODIES = [
  'Internal note: customer SLA at risk — escalate to P1.',
  'Internal: correlated with the Redis eviction spike in Grafana.',
  'Internal: root cause identified — misconfigured Jira webhook secret.',
  'Internal: test environment only — do not expose in portal response.',
  'Internal: waiting for IAM policy change approval.',
  'Internal: related to INFRA-207, fixed in next release.',
];

// Long body for serialisation edge cases (~100 chars each repeat)
const LONG_BODY_SEGMENT =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque sed est non est. ';

function longBody(prng: SeededPrng): string {
  const repeats = prng.int(10, 50);
  return LONG_BODY_SEGMENT.repeat(repeats).trim();
}

export function buildComments(
  prng: SeededPrng,
  tickets: SeedTicket[],
  staffUserIds: string[],
  totalCount: number,
): SeedComment[] {
  const comments: SeedComment[] = [];

  if (tickets.length === 0) return comments;

  const commentsPerTicket = Math.max(1, Math.floor(totalCount / tickets.length));

  for (const ticket of tickets) {
    const count = prng.int(
      Math.max(1, commentsPerTicket - 3),
      commentsPerTicket + 4,
    );
    for (let i = 0; i < count && comments.length < totalCount; i++) {
      const visibility: 'public' | 'internal' = prng.chance(0.3) ? 'internal' : 'public';
      const isLong = prng.chance(0.03); // 3% chance of long body
      const body = isLong
        ? longBody(prng)
        : visibility === 'internal'
        ? prng.pick(INTERNAL_BODIES)
        : prng.pick(SHORT_BODIES);

      const authorId =
        staffUserIds.length > 0 ? prng.pick(staffUserIds) : prng.uuid();
      const createdAt = new Date(
        ticket.createdAt.getTime() + prng.int(60_000, 7 * 86_400_000),
      );
      comments.push({
        id: prng.uuid(),
        tenantId: ticket.tenantId,
        ticketId: ticket.id,
        authorId,
        body,
        visibility,
        createdAt,
        updatedAt: new Date(createdAt.getTime() + prng.int(0, 3_600_000)),
      });
    }
  }
  return comments;
}
