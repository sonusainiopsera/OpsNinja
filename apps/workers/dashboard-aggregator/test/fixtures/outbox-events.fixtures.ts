/**
 * Outbox event fixtures for dashboard-aggregator unit and integration tests.
 * Covers all handled event types across two tenants.
 */

export const TENANT_A = '00000000-0000-0000-0000-000000000001';
export const TENANT_B = '00000000-0000-0000-0000-000000000002';
export const TICKET_1 = '11111111-1111-1111-1111-111111111101';
export const TICKET_2 = '11111111-1111-1111-1111-111111111102';
export const ORG_1    = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function mkEvent(overrides: Record<string, unknown>) {
  return {
    eventId:       '00000000-0000-0000-0000-000000000099',
    tenantId:      TENANT_A,
    aggregateType: 'ticket',
    aggregateId:   TICKET_1,
    eventType:     'ticket.created',
    occurredAt:    '2026-01-01T00:00:00.000Z',
    payload:       {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Ticket events
// ---------------------------------------------------------------------------

export const ticketCreatedP1 = mkEvent({
  eventId:   '00000000-0000-0000-0000-000000000001',
  eventType: 'ticket.created',
  payload: { ticketId: TICKET_1, tenantId: TENANT_A, priority: 'P1', status: 'open', organizationId: ORG_1 },
});

export const ticketCreatedP2 = mkEvent({
  eventId:   '00000000-0000-0000-0000-000000000002',
  eventType: 'ticket.created',
  payload: { ticketId: TICKET_2, tenantId: TENANT_A, priority: 'P2', status: 'open', organizationId: ORG_1 },
});

export const ticketPriorityP1ToP3 = mkEvent({
  eventId:   '00000000-0000-0000-0000-000000000003',
  aggregateId: TICKET_1,
  eventType: 'ticket.priority_changed',
  payload: { ticketId: TICKET_1, tenantId: TENANT_A, previousPriority: 'P1', newPriority: 'P3', organizationId: ORG_1 },
});

export const ticketResolved = mkEvent({
  eventId:   '00000000-0000-0000-0000-000000000004',
  aggregateId: TICKET_1,
  eventType: 'ticket.resolved',
  payload: { ticketId: TICKET_1, tenantId: TENANT_A, previousStatus: 'open', newStatus: 'resolved', priority: 'P3', organizationId: ORG_1 },
});

export const ticketReopened = mkEvent({
  eventId:   '00000000-0000-0000-0000-000000000005',
  aggregateId: TICKET_1,
  eventType: 'ticket.reopened',
  payload: { ticketId: TICKET_1, tenantId: TENANT_A, priority: 'P3', organizationId: ORG_1 },
});

export const ticketClosed = mkEvent({
  eventId:   '00000000-0000-0000-0000-000000000006',
  aggregateId: TICKET_2,
  eventType: 'ticket.closed',
  payload: { ticketId: TICKET_2, tenantId: TENANT_A, previousStatus: 'open', newStatus: 'closed', priority: 'P2', organizationId: ORG_1 },
});

// ---------------------------------------------------------------------------
// SLA events
// ---------------------------------------------------------------------------

export const slaTimerStarted = mkEvent({
  eventId:       '00000000-0000-0000-0000-000000000010',
  aggregateType: 'sla_timer',
  eventType:     'sla.timer_started',
  payload: { ticketId: TICKET_1, tenantId: TENANT_A, clockType: 'response', nextFireAt: '2026-01-01T01:00:00.000Z' },
});

export const slaTimerPaused = mkEvent({
  eventId:       '00000000-0000-0000-0000-000000000011',
  aggregateType: 'sla_timer',
  eventType:     'sla.timer_paused',
  payload: { ticketId: TICKET_1, tenantId: TENANT_A, clockType: 'response' },
});

export const slaTimerResumed = mkEvent({
  eventId:       '00000000-0000-0000-0000-000000000012',
  aggregateType: 'sla_timer',
  eventType:     'sla.timer_resumed',
  payload: { ticketId: TICKET_1, tenantId: TENANT_A, clockType: 'response', nextFireAt: '2026-01-01T02:00:00.000Z' },
});

export const slaThresholdReached = mkEvent({
  eventId:       '00000000-0000-0000-0000-000000000013',
  aggregateType: 'sla_timer',
  eventType:     'sla.threshold_reached',
  payload: { ticketId: TICKET_1, tenantId: TENANT_A, clockType: 'response', thresholdPct: 80 },
});

export const slaBreached = mkEvent({
  eventId:       '00000000-0000-0000-0000-000000000014',
  aggregateType: 'sla_timer',
  eventType:     'sla.breached',
  payload: { ticketId: TICKET_1, tenantId: TENANT_A, clockType: 'response' },
});

// ---------------------------------------------------------------------------
// AI events
// ---------------------------------------------------------------------------

export const aiSynthesisSucceeded = mkEvent({
  eventId:       '00000000-0000-0000-0000-000000000020',
  aggregateType: 'ticket',
  eventType:     'ai.synthesis_completed',
  payload: {
    ticketId: TICKET_1, tenantId: TENANT_A, aiStatus: 'succeeded', areaCount: 2,
    affectedAreas: [{ areaLabel: 'authentication', confidence: '0.95' }, { areaLabel: 'billing', confidence: '0.7' }],
  },
});

export const aiSynthesisFailed = mkEvent({
  eventId:       '00000000-0000-0000-0000-000000000021',
  aggregateType: 'ticket',
  eventType:     'ai.synthesis_completed',
  payload: { ticketId: TICKET_2, tenantId: TENANT_A, aiStatus: 'failed' },
});

// ---------------------------------------------------------------------------
// Tenant B events (cross-tenant isolation test)
// ---------------------------------------------------------------------------

export const tenantBTicketCreated = mkEvent({
  eventId:   '00000000-0000-0000-0000-000000000030',
  tenantId:  TENANT_B,
  aggregateId: '22222222-2222-2222-2222-222222222201',
  eventType: 'ticket.created',
  payload: { ticketId: '22222222-2222-2222-2222-222222222201', tenantId: TENANT_B, priority: 'P1', status: 'open', organizationId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
});

// ---------------------------------------------------------------------------
// JSON fixtures (for SQS envelope tests)
// ---------------------------------------------------------------------------

export function makeSqsBody(event: Record<string, unknown>): string {
  return JSON.stringify(event);
}

export function makeSnsSqsBody(event: Record<string, unknown>): string {
  return JSON.stringify({ Type: 'Notification', Message: JSON.stringify(event) });
}
