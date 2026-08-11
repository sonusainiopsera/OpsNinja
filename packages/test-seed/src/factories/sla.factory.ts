/**
 * Pure factory for SLA policies and timers.
 * Produces running, paused (with accumulated paused_ms) and breached states.
 */

import type { SeededPrng } from '../prng';
import type { SeedTenant } from './organizations.factory';
import type { SeedTicket, TicketPriority } from './tickets.factory';

export interface SeedSlaPolicy {
  id: string;
  tenantId: string;
  name: string;
  priority: TicketPriority;
  /** Response target in minutes */
  responseTargetMinutes: number;
  /** Resolution target in minutes */
  resolutionTargetMinutes: number;
  isActive: boolean;
  createdAt: Date;
}

export type SlaTimerStatus = 'running' | 'paused' | 'breached';

export interface SeedSlaTimer {
  id: string;
  tenantId: string;
  ticketId: string;
  policyId: string;
  status: SlaTimerStatus;
  /** Epoch ms when the timer should fire next (next_fire_at) */
  nextFireAt: Date;
  /** Epoch ms target deadline */
  targetAt: Date;
  /** Accumulated paused milliseconds */
  pausedMs: number;
  /** When the timer was last paused (null if running) */
  pausedAt: Date | null;
  createdAt: Date;
}

// Standard SLA targets per priority (minutes)
const SLA_TARGETS: Record<TicketPriority, { response: number; resolution: number }> = {
  p1: { response: 15, resolution: 240 },
  p2: { response: 60, resolution: 480 },
  p3: { response: 240, resolution: 1440 },
  p4: { response: 480, resolution: 2880 },
};

export function buildSlaPolicies(
  prng: SeededPrng,
  tenants: SeedTenant[],
  now: Date,
): SeedSlaPolicy[] {
  const policies: SeedSlaPolicy[] = [];
  for (const tenant of tenants) {
    for (const priority of ['p1', 'p2', 'p3', 'p4'] as TicketPriority[]) {
      const targets = SLA_TARGETS[priority];
      policies.push({
        id: prng.uuid(),
        tenantId: tenant.id,
        name: `${priority.toUpperCase()} SLA`,
        priority,
        responseTargetMinutes: targets.response,
        resolutionTargetMinutes: targets.resolution,
        isActive: true,
        createdAt: new Date(now.getTime() - 30 * 86_400_000),
      });
    }
  }
  return policies;
}

export function buildSlaTimers(
  prng: SeededPrng,
  tickets: SeedTicket[],
  policies: SeedSlaPolicy[],
  now: Date,
): SeedSlaTimer[] {
  const timers: SeedSlaTimer[] = [];
  const policyByTenantAndPriority = new Map<string, SeedSlaPolicy>();
  for (const p of policies) {
    policyByTenantAndPriority.set(`${p.tenantId}:${p.priority}`, p);
  }

  for (const ticket of tickets) {
    const policy = policyByTenantAndPriority.get(`${ticket.tenantId}:${ticket.priority}`);
    if (!policy) continue;

    const resolutionMs = policy.resolutionTargetMinutes * 60 * 1000;
    const targetAt = new Date(ticket.createdAt.getTime() + resolutionMs);

    let status: SlaTimerStatus;
    let pausedMs = 0;
    let pausedAt: Date | null = null;
    let nextFireAt: Date;

    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      // Closed tickets: mark as completed or breached based on resolvedAt vs targetAt
      const resolvedAt = ticket.resolvedAt ?? now;
      status = resolvedAt > targetAt ? 'breached' : 'running';
      nextFireAt = targetAt;
    } else if (ticket.status === 'pending') {
      // Pending = paused
      status = 'paused';
      pausedMs = prng.int(0, resolutionMs / 4);
      pausedAt = new Date(now.getTime() - prng.int(3_600_000, 24 * 3_600_000));
      nextFireAt = new Date(targetAt.getTime() + pausedMs);
    } else {
      // Open/in_progress: either running or breached
      if (now > targetAt) {
        status = 'breached';
        nextFireAt = new Date(now.getTime() + 5 * 60 * 1000); // next check in 5m
      } else {
        status = 'running';
        nextFireAt = targetAt;
      }
    }

    timers.push({
      id: prng.uuid(),
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      policyId: policy.id,
      status,
      nextFireAt,
      targetAt,
      pausedMs,
      pausedAt,
      createdAt: ticket.createdAt,
    });
  }
  return timers;
}
