/**
 * Pure factory for audit log records.
 * Produces records spanning multiple created_at partitions.
 */

import type { SeededPrng } from '../prng';
import type { SeedTenant } from './organizations.factory';
import type { SeedTicket } from './tickets.factory';

export interface SeedAuditLog {
  id: string;
  tenantId: string;
  actorId: string | null;
  actorKind: string;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  code: string;
  traceId: string;
  requestId: string;
  metadata: Record<string, unknown> | null;
  occurredAt: Date;
}

const ACTIONS = [
  'ticket.created',
  'ticket.updated',
  'ticket.status_transitioned',
  'ticket.assigned',
  'comment.created',
  'auth.login',
  'auth.logout',
  'auth.token_refreshed',
  'org.updated',
  'webhook.endpoint_created',
];

const ACTOR_KINDS = ['user', 'system', 'integration'];
const OUTCOMES = ['success', 'failure'];
const ROLES = ['agent', 'manager', 'support_admin', 'analyst'];

export function buildAuditLogs(
  prng: SeededPrng,
  tenants: SeedTenant[],
  tickets: SeedTicket[],
  staffUserIds: string[],
  windowStart: Date,
  windowEnd: Date,
): SeedAuditLog[] {
  const logs: SeedAuditLog[] = [];
  const windowMs = windowEnd.getTime() - windowStart.getTime();
  const usersPerTenant = Math.max(1, Math.floor(staffUserIds.length / tenants.length));

  for (let ti = 0; ti < tenants.length; ti++) {
    const tenant = tenants[ti];
    const tenantUserIds = staffUserIds.slice(ti * usersPerTenant, (ti + 1) * usersPerTenant);
    const tenantTickets = tickets.filter((t) => t.tenantId === tenant.id);

    // One audit record per ticket event
    for (const ticket of tenantTickets) {
      const action = prng.pick(ACTIONS);
      const actorId = tenantUserIds.length > 0 ? prng.pick(tenantUserIds) : null;
      logs.push({
        id: prng.uuid(),
        tenantId: tenant.id,
        actorId,
        actorKind: prng.pick(ACTOR_KINDS),
        actorRole: prng.pick(ROLES),
        action,
        resourceType: 'ticket',
        resourceId: ticket.id,
        outcome: prng.chance(0.95) ? 'success' : 'failure',
        code: action,
        traceId: prng.uuid(),
        requestId: prng.uuid(),
        metadata: null,
        occurredAt: ticket.createdAt,
      });
    }

    // Additional auth events spread across the window
    const authCount = Math.floor(tenantTickets.length * 0.2);
    for (let i = 0; i < authCount; i++) {
      const action = prng.pick(['auth.login', 'auth.logout', 'auth.token_refreshed']);
      const offset = Math.floor(prng.next() * windowMs);
      logs.push({
        id: prng.uuid(),
        tenantId: tenant.id,
        actorId: tenantUserIds.length > 0 ? prng.pick(tenantUserIds) : null,
        actorKind: 'user',
        actorRole: null,
        action,
        resourceType: 'session',
        resourceId: null,
        outcome: 'success',
        code: action,
        traceId: prng.uuid(),
        requestId: prng.uuid(),
        metadata: null,
        occurredAt: new Date(windowStart.getTime() + offset),
      });
    }
  }
  return logs;
}
