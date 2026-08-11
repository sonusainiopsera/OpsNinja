/**
 * SLA event handlers — pure functions returning Redis mutation commands.
 *
 * Handles: sla.timer_started, sla.timer_paused, sla.timer_resumed,
 *          sla.threshold_reached, sla.breached.
 *
 * breach_risk sorted set is scored by next_fire_at epoch ms so the snapshot
 * API can range-query the soonest N approaching timers.
 */

import { Keys } from '../redis/keys';
import type { MutationCmd } from '../redis/aggregate.store';
import type { OutboxEvent } from '../outbox-event.schema';

// ---------------------------------------------------------------------------
// sla.timer_started
// ---------------------------------------------------------------------------

export function handleSlaTimerStarted(event: OutboxEvent): MutationCmd[] {
  const p = event.payload;
  const tenantId = event.tenantId;
  const ticketId = event.aggregateId;
  const nextFireAt = p['nextFireAt'] ? new Date(p['nextFireAt'] as string).getTime() : null;
  const cmds: MutationCmd[] = [
    ['HINCRBY', Keys.kpi(tenantId), 'running_slas', 1],
  ];
  if (nextFireAt) {
    cmds.push(['ZADD', Keys.breachRisk(tenantId), 'GT', nextFireAt, ticketId]);
  }
  return cmds;
}

// ---------------------------------------------------------------------------
// sla.timer_paused
// ---------------------------------------------------------------------------

export function handleSlaTimerPaused(event: OutboxEvent): MutationCmd[] {
  const tenantId = event.tenantId;
  const ticketId = event.aggregateId;
  return [
    ['HINCRBY', Keys.kpi(tenantId), 'running_slas', -1],
    ['ZREM', Keys.breachRisk(tenantId), ticketId],
  ];
}

// ---------------------------------------------------------------------------
// sla.timer_resumed
// ---------------------------------------------------------------------------

export function handleSlaTimerResumed(event: OutboxEvent): MutationCmd[] {
  const p = event.payload;
  const tenantId = event.tenantId;
  const ticketId = event.aggregateId;
  const nextFireAt = p['nextFireAt'] ? new Date(p['nextFireAt'] as string).getTime() : null;
  const cmds: MutationCmd[] = [
    ['HINCRBY', Keys.kpi(tenantId), 'running_slas', 1],
  ];
  if (nextFireAt) {
    cmds.push(['ZADD', Keys.breachRisk(tenantId), 'GT', nextFireAt, ticketId]);
  }
  return cmds;
}

// ---------------------------------------------------------------------------
// sla.threshold_reached
// ---------------------------------------------------------------------------

export function handleSlaThresholdReached(event: OutboxEvent): MutationCmd[] {
  const tenantId = event.tenantId;
  return [
    ['HINCRBY', Keys.kpi(tenantId), 'approaching_breach', 1],
  ];
}

// ---------------------------------------------------------------------------
// sla.breached
// ---------------------------------------------------------------------------

export function handleSlaBreached(event: OutboxEvent): MutationCmd[] {
  const tenantId = event.tenantId;
  const ticketId = event.aggregateId;
  return [
    ['HINCRBY', Keys.kpi(tenantId), 'running_slas', -1],
    ['HINCRBY', Keys.kpi(tenantId), 'approaching_breach', -1],
    ['ZREM', Keys.breachRisk(tenantId), ticketId],
  ];
}
