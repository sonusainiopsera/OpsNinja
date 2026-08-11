/**
 * Comment factory — pure functional, no DB access.
 *
 * Generates ticket comments with public/internal visibility mix.
 * Includes edge-case bodies: Unicode, emoji, and very long content.
 */

import type { NewTicketComment } from '@opsninja/db';
import { SeededRandom } from '../prng';

const PUBLIC_BODIES = [
  'Thank you for reaching out. We are investigating this issue.',
  'Could you please provide additional details about the error?',
  'We have identified the root cause and are working on a fix.',
  'The issue has been resolved. Please let us know if it recurs.',
  'Your ticket has been escalated to our senior support team.',
  'We apologize for the inconvenience. A fix will be deployed shortly.',
  'Can you share a screenshot of the error message?',
  'Please try clearing your browser cache and cookies.',
  // Unicode + emoji edge case
  'Update: ticket resolved ✅. Please rate your experience 🌟',
  'Проблема решена. Пожалуйста, подтвердите.',
  // Long body (32KB)
  'L'.repeat(32_768),
];

const INTERNAL_BODIES = [
  '[Internal] Escalated to platform team. SLA breach in 2 hours.',
  '[Internal] Root cause: missing index on tenant_id + status. Added.',
  '[Internal] Customer VIP — prioritize and update every 30 minutes.',
  '[Internal] Known issue JIRA-1042. Tracking for next release.',
  '[Internal] Auto-assigned by SLA policy: senior_agent queue.',
];

export interface CommentSeed {
  id: string;
  tenantId: string;
  ticketId: string;
  record: NewTicketComment;
}

export function buildComments(
  rng: SeededRandom,
  tenantId: string,
  tickets: Array<{ id: string; organizationId: string }>,
  commentsPerTicket: number,
  userIds: string[],
): CommentSeed[] {
  const comments: CommentSeed[] = [];

  for (const ticket of tickets) {
    const count = rng.nextIntRange(
      Math.max(1, commentsPerTicket - 3),
      commentsPerTicket + 3,
    );

    for (let i = 0; i < count; i++) {
      const r = rng.child(i + 400);
      const id = r.uuid();
      const isInternal = rng.nextBool(0.2);
      const body = isInternal
        ? rng.pick(INTERNAL_BODIES)
        : rng.pick(PUBLIC_BODIES);
      const authorId = userIds.length > 0 && rng.nextBool(0.9)
        ? rng.pick(userIds)
        : null;

      comments.push({
        id,
        tenantId,
        ticketId: ticket.id,
        record: {
          id,
          tenantId,
          ticketId: ticket.id,
          organizationId: ticket.organizationId,
          authorId,
          body,
          visibility: isInternal ? 'internal' : 'public',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
  }

  return comments;
}
