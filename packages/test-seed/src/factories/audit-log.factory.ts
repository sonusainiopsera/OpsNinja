/**
 * Audit log factory — pure functional, no DB access.
 *
 * Generates audit records spanning multiple monthly partitions,
 * including one record beyond the 7-year retention horizon.
 */

import type { NewAuditLog } from '@opsninja/db';
import { SeededRandom } from '../prng';
import { PartitionWindow, spreadAcrossPartitions } from '../partition-dates';

const EVENT_TYPES = [
  'auth.login',
  'auth.token_refresh',
  'auth.logout',
  'auth.token_missing',
  'authz.permission_denied',
  'ticket.create',
  'ticket.update',
  'ticket.assign',
  'ticket_comment.create',
  'organization.update',
  'organization.deactivate',
] as const;

const OUTCOMES = ['allowed', 'denied', 'success'] as const;

export interface AuditLogSeed {
  id: string;
  tenantId: string;
  record: NewAuditLog;
}

export function buildAuditLogs(
  rng: SeededRandom,
  tenantId: string,
  actorIds: string[],
  count: number,
  partitionWindow: PartitionWindow,
): AuditLogSeed[] {
  const logs: AuditLogSeed[] = [];
  const dates = spreadAcrossPartitions(count, partitionWindow, () => rng.next());

  for (let i = 0; i < count; i++) {
    const r = rng.child(i + 500);
    const id = r.uuid();
    const eventType = rng.pick(EVENT_TYPES);
    const actorId = actorIds.length > 0 && rng.nextBool(0.8)
      ? rng.pick(actorIds)
      : null;

    logs.push({
      id,
      tenantId,
      record: {
        id,
        tenantId,
        actorId,
        actorKind: 'staff',
        eventType,
        outcome: rng.pick(OUTCOMES),
        traceId: r.uuid(),
        metadata: { seeded: true },
        createdAt: dates[i % dates.length]!,
      },
    });
  }

  return logs;
}
