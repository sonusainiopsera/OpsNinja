/**
 * CSAT survey factory — WO-085.
 *
 * Generates anonymised CSAT survey rows for non-production seeding.
 * All comments are drawn from a synthetic corpus with no real customer PII.
 * The AnonymisationValidator checks that no real email domains appear in any
 * generated value; CSAT surveys contain no emails, only text comments.
 */

import type { NewCsatSurvey } from '@opsninja/db';
import { SeededRandom } from '../prng';
import { PartitionWindow, spreadAcrossPartitions } from '../partition-dates';

// Synthetic CSAT comment corpus — no real customer PII.
const SYNTHETIC_COMMENTS: (string | null)[] = [
  'Resolved quickly and professionally.',
  'Support agent was knowledgeable and polite.',
  'Issue took longer than expected but was resolved.',
  'Very satisfied with the response time.',
  'The agent went above and beyond.',
  'Response was adequate but could be faster.',
  'Excellent service, resolved on first contact.',
  null, // represents a no-comment submission
  null,
  null,
  'Some delay in response but the outcome was good.',
  'Agent was friendly and resolved the issue.',
  'Satisfied overall.',
  'The resolution process was clear and straightforward.',
  'Could have been resolved faster but the outcome was correct.',
];

const SCORES = [1, 2, 3, 4, 5] as const;
const SOURCES = ['one_click', 'form'] as const;

export interface CsatSurveySeed {
  id:       string;
  tenantId: string;
  record:   NewCsatSurvey;
}

/**
 * Generate `count` anonymised CSAT survey rows for a tenant.
 * A proportion (respondedFraction) of rows have a score+comment;
 * the remainder are unresponded (pending).
 */
export function buildCsatSurveys(
  rng: SeededRandom,
  tenantId: string,
  contactIds: string[],
  ticketIds: string[],
  count: number,
  partitionWindow: PartitionWindow,
  respondedFraction = 0.6,
): CsatSurveySeed[] {
  const seeds: CsatSurveySeed[] = [];
  const dates = spreadAcrossPartitions(count, partitionWindow, () => rng.next());

  for (let i = 0; i < count; i++) {
    const r           = rng.child(i + 900);
    const id          = r.uuid();
    const contactId   = contactIds.length > 0 ? rng.pick(contactIds) : null;
    const ticketId    = ticketIds.length > 0 ? rng.pick(ticketIds) : r.uuid();
    const createdAt   = dates[i]!;
    const expiresAt   = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const responded   = rng.nextBool(respondedFraction);
    const respondedAt = responded
      ? new Date(createdAt.getTime() + rng.nextInt() % (24 * 60 * 60 * 1000) + 60_000)
      : null;

    seeds.push({
      id,
      tenantId,
      record: {
        tenantId,
        id,
        ticketId,
        contactId,
        tokenHash:      r.uuid().replace(/-/g, '').slice(0, 64),
        score:          responded ? rng.pick(SCORES) : null,
        comment:        responded ? rng.pick(SYNTHETIC_COMMENTS) : null,
        responseSource: responded ? rng.pick(SOURCES) : null,
        sentAt:         createdAt,
        delivered:      true,
        expiresAt,
        respondedAt,
        createdAt,
      } as NewCsatSurvey,
    });
  }

  return seeds;
}
