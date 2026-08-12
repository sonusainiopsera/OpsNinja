/**
 * Notification factory — WO-085.
 *
 * Generates anonymised notification rows for non-production seeding.
 * All recipient addresses use example.invalid domain to satisfy the
 * anonymisation validator (AnonymisationValidator will reject real domains).
 *
 * Spans multiple monthly partitions for retention testing.
 */

import type { NewNotification } from '@opsninja/db';
import { SeededRandom } from '../prng';
import { PartitionWindow, spreadAcrossPartitions } from '../partition-dates';

const TEMPLATE_KEYS = [
  'ticket.created',
  'ticket.resolved',
  'ticket.comment.added',
  'ticket.assigned',
  'csat.survey.sent',
  'sla.breach.warning',
  'sla.breach.escalation',
] as const;

const CHANNELS = ['email'] as const;
const STATUSES = ['queued', 'sent', 'failed', 'suppressed'] as const;

export interface NotificationSeed {
  id:       string;
  tenantId: string;
  record:   NewNotification;
}

/**
 * Generate `count` anonymised notification rows spread across the given
 * partition window. All emails use @example.invalid.
 */
export function buildNotifications(
  rng: SeededRandom,
  tenantId: string,
  contactIds: string[],
  ticketIds: string[],
  count: number,
  partitionWindow: PartitionWindow,
): NotificationSeed[] {
  const seeds: NotificationSeed[] = [];
  const dates = spreadAcrossPartitions(count, partitionWindow, () => rng.next());

  for (let i = 0; i < count; i++) {
    const r            = rng.child(i + 800);
    const id           = r.uuid();
    const contactId    = contactIds.length > 0 ? rng.pick(contactIds) : null;
    const ticketId     = ticketIds.length > 0 && rng.nextBool(0.8)
      ? rng.pick(ticketIds)
      : null;
    const templateKey  = rng.pick(TEMPLATE_KEYS);
    const status       = rng.pick(STATUSES);
    const createdAt    = dates[i]!;

    // Use example.invalid — validated by AnonymisationValidator.
    const emailIndex   = Math.abs(r.nextInt()) % 9999;
    const recipientEmail = `user-${emailIndex}@example.invalid`;

    seeds.push({
      id,
      tenantId,
      record: {
        id,
        tenantId,
        ticketId,
        recipientContactId: contactId,
        recipientEmail,
        channel:     'email',
        templateKey,
        payload:     { ticketId, templateKey },
        dedupeKey:   `${tenantId}:${ticketId ?? 'none'}:${templateKey}:${id}`,
        status:      status as 'queued' | 'sent' | 'failed' | 'suppressed',
        attempts:    status === 'sent' ? 1 : status === 'failed' ? 3 : 0,
        providerMessageId: status === 'sent' ? `ses-${id.slice(0, 8)}` : null,
        errorCode:   status === 'failed' ? 'SMTP_TIMEOUT' : null,
        createdAt,
        sentAt:      status === 'sent' ? createdAt : null,
      } as NewNotification,
    });
  }

  return seeds;
}
