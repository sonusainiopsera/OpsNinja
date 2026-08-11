/**
 * Pure factory for tickets.
 * Spans multiple created_at partitions to exercise partition pruning.
 */

import type { SeededPrng } from '../prng';
import type { SeedTenant } from './organizations.factory';
import type { CollisionMatrix } from '../collision-matrix';

export interface SeedTicket {
  id: string;
  tenantId: string;
  organizationId: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  createdById: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export type TicketStatus = 'open' | 'in_progress' | 'pending' | 'resolved' | 'closed';
export type TicketPriority = 'p1' | 'p2' | 'p3' | 'p4';

const STATUSES: TicketStatus[] = ['open', 'in_progress', 'pending', 'resolved', 'closed'];
const STATUS_DIST = [3, 3, 1, 2, 1]; // weighted distribution

const PRIORITIES: TicketPriority[] = ['p1', 'p2', 'p3', 'p4'];
const PRIORITY_DIST = [1, 2, 4, 3]; // p4 most common

const SUBJECTS = [
  'Cannot access dashboard',
  'API rate limit exceeded',
  'Login timeout after idle',
  'Webhook delivery failure',
  'SLA breach alert not received',
  'Export stuck in processing',
  'SSO login loop',
  'Jira sync delay',
  'Missing ticket assignment',
  'Report generation error',
  'Performance degradation after deploy',
  'Notification emails not delivered',
  'Custom field validation failure',
  'Portal contact cannot view ticket',
  'Realtime dashboard not updating',
];

function weightedPick<T>(prng: SeededPrng, items: readonly T[], dist: readonly number[]): T {
  const total = dist.reduce((a, b) => a + b, 0);
  let rand = prng.int(0, total);
  for (let i = 0; i < items.length; i++) {
    rand -= dist[i];
    if (rand < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Distributes ticketCount across partitions spanning windowStart..windowEnd.
 * Returns one Date per ticket, ensuring every monthly partition gets ≥1 row.
 */
function spanningDates(
  prng: SeededPrng,
  count: number,
  windowStart: Date,
  windowEnd: Date,
): Date[] {
  const windowMs = windowEnd.getTime() - windowStart.getTime();
  // Compute months in window
  const months: Date[] = [];
  const cursor = new Date(windowStart);
  while (cursor < windowEnd) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const dates: Date[] = [];
  // Guarantee at least one ticket per month
  for (const monthStart of months) {
    const nextMonth = new Date(monthStart);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const monthMs = nextMonth.getTime() - monthStart.getTime();
    const offset = prng.int(0, monthMs);
    dates.push(new Date(monthStart.getTime() + offset));
  }
  // Fill remaining with random distribution
  for (let i = months.length; i < count; i++) {
    const offset = Math.floor(prng.next() * windowMs);
    dates.push(new Date(windowStart.getTime() + offset));
  }
  return dates.slice(0, count).sort((a, b) => a.getTime() - b.getTime());
}

export function buildTickets(
  prng: SeededPrng,
  tenants: SeedTenant[],
  orgIds: string[],
  userIds: string[],
  totalCount: number,
  windowStart: Date,
  windowEnd: Date,
  collisionMatrix: CollisionMatrix,
): SeedTicket[] {
  const orgsPerTenant = Math.floor(orgIds.length / tenants.length);
  const usersPerTenant = Math.floor(userIds.length / tenants.length);
  const ticketsPerTenant = Math.floor(totalCount / tenants.length);
  const tickets: SeedTicket[] = [];

  for (let ti = 0; ti < tenants.length; ti++) {
    const tenant = tenants[ti];
    const tenantOrgIds = orgIds.slice(ti * orgsPerTenant, (ti + 1) * orgsPerTenant);
    const tenantUserIds = userIds.slice(ti * usersPerTenant, (ti + 1) * usersPerTenant);
    const count = ti < tenants.length - 1 ? ticketsPerTenant : totalCount - tickets.length;

    const collisionSubjects = collisionMatrix.ticketSubjects
      .filter((c) => c.pair.tenantAIndex === ti || c.pair.tenantBIndex === ti)
      .map((c) => c.subject);

    const dates = spanningDates(prng, count, windowStart, windowEnd);

    for (let i = 0; i < count; i++) {
      const createdAt = dates[i];
      const status = weightedPick(prng, STATUSES, STATUS_DIST);
      const priority = weightedPick(prng, PRIORITIES, PRIORITY_DIST);
      const isResolved = status === 'resolved' || status === 'closed';
      const resolvedAt = isResolved
        ? new Date(createdAt.getTime() + prng.int(3_600_000, 7 * 86_400_000))
        : null;

      const subject =
        i < collisionSubjects.length
          ? collisionSubjects[i]
          : prng.pick(SUBJECTS);

      tickets.push({
        id: prng.uuid(),
        tenantId: tenant.id,
        organizationId: tenantOrgIds.length > 0 ? prng.pick(tenantOrgIds) : null,
        subject,
        description: `Synthetic ticket #${tickets.length + 1} — ${subject.toLowerCase()}. This description is fully generated for testing purposes only.`,
        status,
        priority,
        assigneeId: prng.chance(0.7) && tenantUserIds.length > 0 ? prng.pick(tenantUserIds) : null,
        createdById: tenantUserIds.length > 0 ? prng.pick(tenantUserIds) : prng.uuid(),
        isPublic: prng.chance(0.85),
        createdAt,
        updatedAt: new Date(createdAt.getTime() + prng.int(0, 5) * 86_400_000),
        resolvedAt,
      });
    }
  }
  return tickets;
}
