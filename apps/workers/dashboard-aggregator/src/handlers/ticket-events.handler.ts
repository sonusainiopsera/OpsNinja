/**
 * Ticket event handlers — pure functions returning Redis mutation commands.
 *
 * Handles: ticket.created, ticket.updated, ticket.priority_changed,
 *          ticket.resolved, ticket.closed, ticket.reopened.
 *
 * Pure: no I/O; take parsed payload → return MutationCmd[].
 * Unit-testable without Redis or NestJS.
 */

import { Keys, FEED_MAX } from '../redis/keys';
import type { MutationCmd } from '../redis/aggregate.store';
import type { OutboxEvent } from '../outbox-event.schema';

const OPEN_STATUSES = new Set(['open', 'new', 'pending_customer', 'pending_engineering']);
const CLOSED_STATUSES = new Set(['resolved', 'closed']);

// ---------------------------------------------------------------------------
// ticket.created
// ---------------------------------------------------------------------------

export function handleTicketCreated(event: OutboxEvent): MutationCmd[] {
  const p = event.payload;
  const tenantId = event.tenantId;
  const ticketId = event.aggregateId;
  const priority = String(p['priority'] ?? 'P3');
  const orgId = String(p['organizationId'] ?? '');
  const status = String(p['status'] ?? 'open');
  const cmds: MutationCmd[] = [];

  if (OPEN_STATUSES.has(status)) {
    cmds.push(['HINCRBY', Keys.kpi(tenantId), 'open_total', 1]);
    if (priority === 'P1') cmds.push(['HINCRBY', Keys.kpi(tenantId), 'active_p1', 1]);
    if (priority === 'P2') cmds.push(['HINCRBY', Keys.kpi(tenantId), 'active_p2', 1]);
    if (orgId) cmds.push(['HINCRBY', Keys.orgLoad(tenantId), orgId, 1]);
  }

  cmds.push(...feedEntry(tenantId, event, { ticketId, priority, orgId }));
  return cmds;
}

// ---------------------------------------------------------------------------
// ticket.priority_changed
// ---------------------------------------------------------------------------

export function handleTicketPriorityChanged(event: OutboxEvent): MutationCmd[] {
  const p = event.payload;
  const tenantId = event.tenantId;
  const prev = String(p['previousPriority'] ?? '');
  const next = String(p['newPriority'] ?? '');
  const cmds: MutationCmd[] = [];

  if (prev === 'P1') cmds.push(['HINCRBY', Keys.kpi(tenantId), 'active_p1', -1]);
  if (prev === 'P2') cmds.push(['HINCRBY', Keys.kpi(tenantId), 'active_p2', -1]);
  if (next === 'P1') cmds.push(['HINCRBY', Keys.kpi(tenantId), 'active_p1', 1]);
  if (next === 'P2') cmds.push(['HINCRBY', Keys.kpi(tenantId), 'active_p2', 1]);

  cmds.push(...feedEntry(tenantId, event, { priority: next }));
  return cmds;
}

// ---------------------------------------------------------------------------
// ticket.resolved / ticket.closed
// ---------------------------------------------------------------------------

export function handleTicketClosedOrResolved(event: OutboxEvent): MutationCmd[] {
  const p = event.payload;
  const tenantId = event.tenantId;
  const prevStatus = String(p['previousStatus'] ?? 'open');
  const priority = String(p['priority'] ?? 'P3');
  const orgId = String(p['organizationId'] ?? '');
  const cmds: MutationCmd[] = [];

  if (OPEN_STATUSES.has(prevStatus)) {
    cmds.push(['HINCRBY', Keys.kpi(tenantId), 'open_total', -1]);
    if (priority === 'P1') cmds.push(['HINCRBY', Keys.kpi(tenantId), 'active_p1', -1]);
    if (priority === 'P2') cmds.push(['HINCRBY', Keys.kpi(tenantId), 'active_p2', -1]);
    if (orgId) cmds.push(['HINCRBY', Keys.orgLoad(tenantId), orgId, -1]);
  }

  // Remove from breach_risk on close/resolve
  cmds.push(['ZREM', Keys.breachRisk(tenantId), event.aggregateId]);
  cmds.push(...feedEntry(tenantId, event, { priority, orgId }));
  return cmds;
}

// ---------------------------------------------------------------------------
// ticket.reopened
// ---------------------------------------------------------------------------

export function handleTicketReopened(event: OutboxEvent): MutationCmd[] {
  const p = event.payload;
  const tenantId = event.tenantId;
  const priority = String(p['priority'] ?? 'P3');
  const orgId = String(p['organizationId'] ?? '');
  const cmds: MutationCmd[] = [];

  cmds.push(['HINCRBY', Keys.kpi(tenantId), 'open_total', 1]);
  if (priority === 'P1') cmds.push(['HINCRBY', Keys.kpi(tenantId), 'active_p1', 1]);
  if (priority === 'P2') cmds.push(['HINCRBY', Keys.kpi(tenantId), 'active_p2', 1]);
  if (orgId) cmds.push(['HINCRBY', Keys.orgLoad(tenantId), orgId, 1]);

  cmds.push(...feedEntry(tenantId, event, { priority, orgId }));
  return cmds;
}

// ---------------------------------------------------------------------------
// ticket.updated (generic — currently only updates feed)
// ---------------------------------------------------------------------------

export function handleTicketUpdated(event: OutboxEvent): MutationCmd[] {
  return feedEntry(event.tenantId, event, {});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function feedEntry(
  tenantId: string,
  event: OutboxEvent,
  extra: Record<string, unknown>,
): MutationCmd[] {
  const entry = JSON.stringify({
    eventType: event.eventType,
    ticketId: event.aggregateId,
    occurredAt: event.occurredAt,
    ...extra,
  });
  return [
    ['LPUSH', Keys.feed(tenantId), entry],
    ['LTRIM', Keys.feed(tenantId), 0, FEED_MAX - 1],
  ];
}
