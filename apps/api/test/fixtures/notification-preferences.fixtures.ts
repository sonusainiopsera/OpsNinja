/**
 * Test fixtures for WO-081 notification preferences and rule resolver tests.
 *
 * Covers:
 *  - Two tenants with organizations, contacts, watchers
 *  - An on-call schedule entry (represented as assignment group member)
 *  - Preference rows: org default, contact override, off-mode
 *  - Outbox event fixtures for all 8 notification-eligible event types
 */

// ---------------------------------------------------------------------------
// Fixed UUIDs (deterministic across runs)
// ---------------------------------------------------------------------------

export const TENANT_A = '10000000-0000-0000-0000-000000000001';
export const TENANT_B = '10000000-0000-0000-0000-000000000002';

export const ORG_A1 = '20000000-0000-0000-0000-000000000001'; // Acme Corp (TENANT_A)
export const ORG_B1 = '20000000-0000-0000-0000-000000000002'; // Beta Ltd (TENANT_B)

export const CONTACT_A1 = '30000000-0000-0000-0000-000000000001'; // Alice (ORG_A1, portal user)
export const CONTACT_A2 = '30000000-0000-0000-0000-000000000002'; // Bob (ORG_A1, portal user)
export const CONTACT_B1 = '30000000-0000-0000-0000-000000000003'; // Carol (ORG_B1, portal user)

export const AGENT_1 = '40000000-0000-0000-0000-000000000001'; // Agent in TENANT_A
export const TICKET_1 = '50000000-0000-0000-0000-000000000001';
export const TICKET_2 = '50000000-0000-0000-0000-000000000002';

export const ASSIGNMENT_GROUP_1 = '60000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Preference rows
// ---------------------------------------------------------------------------

/** Org-level default for TENANT_A/ORG_A1: all events on email immediately. */
export const orgDefaultPreferences = [
  { eventType: 'ticket.created', channel: 'email', mode: 'immediate' as const },
  { eventType: 'ticket.status_changed', channel: 'email', mode: 'immediate' as const },
  { eventType: 'ticket.comment_added', channel: 'email', mode: 'immediate' as const },
  { eventType: 'ticket.resolved', channel: 'email', mode: 'immediate' as const },
];

/** CONTACT_A1 override: has opted out of status_changed emails. */
export const contactA1Overrides = [
  { eventType: 'ticket.status_changed', channel: 'email', mode: 'off' as const },
];

/** CONTACT_A2 override: everything immediate (no change from org default). */
export const contactA2Overrides: typeof contactA1Overrides = [];

// ---------------------------------------------------------------------------
// Outbox event fixtures — one per catalogue event type
// ---------------------------------------------------------------------------

export function makeTicketCreatedEvent(tenantId = TENANT_A, ticketId = TICKET_1) {
  return {
    eventId: `evt-created-${ticketId}`,
    tenantId,
    aggregateType: 'ticket',
    aggregateId: ticketId,
    eventType: 'ticket.created',
    occurredAt: '2026-01-15T10:00:00Z',
    actorId: AGENT_1,
    payload: {
      ticketId,
      reference: 'TKT-1001',
      subject: 'Cannot access portal',
      status: 'open',
      priority: 'P2',
      categoryPath: 'Access > Portal',
      organizationId: ORG_A1,
      actorDisplayName: 'Alice Agent',
      updatedAt: '2026-01-15T10:00:00Z',
    },
  };
}

export function makeTicketStatusChangedEvent(tenantId = TENANT_A, ticketId = TICKET_1) {
  return {
    eventId: `evt-status-${ticketId}`,
    tenantId,
    aggregateType: 'ticket',
    aggregateId: ticketId,
    eventType: 'ticket.status_changed',
    occurredAt: '2026-01-15T10:05:00Z',
    actorId: AGENT_1,
    payload: {
      ticketId,
      reference: 'TKT-1001',
      subject: 'Cannot access portal',
      status: 'in_progress',
      priority: 'P2',
      updatedAt: '2026-01-15T10:05:00Z',
      actorDisplayName: 'Alice Agent',
      organizationId: ORG_A1,
    },
  };
}

export function makePublicCommentAddedEvent(tenantId = TENANT_A, ticketId = TICKET_1) {
  return {
    eventId: `evt-comment-pub-${ticketId}`,
    tenantId,
    aggregateType: 'ticket',
    aggregateId: ticketId,
    eventType: 'ticket.comment_added',
    occurredAt: '2026-01-15T10:10:00Z',
    actorId: AGENT_1,
    payload: {
      ticketId,
      reference: 'TKT-1001',
      subject: 'Cannot access portal',
      status: 'in_progress',
      priority: 'P2',
      visibility: 'public',
      commentBody: 'We are investigating the issue.',
      actorDisplayName: 'Alice Agent',
      updatedAt: '2026-01-15T10:10:00Z',
      organizationId: ORG_A1,
    },
  };
}

export function makeInternalCommentAddedEvent(tenantId = TENANT_A, ticketId = TICKET_1) {
  return {
    eventId: `evt-comment-int-${ticketId}`,
    tenantId,
    aggregateType: 'ticket',
    aggregateId: ticketId,
    eventType: 'ticket.comment_added',
    occurredAt: '2026-01-15T10:12:00Z',
    actorId: AGENT_1,
    payload: {
      ticketId,
      visibility: 'internal',
      commentBody: 'Check Jira XY-404 — do NOT share with customer',
      internalNoteBody: 'Customer has outdated firmware',
      organizationId: ORG_A1,
    },
  };
}

export function makeAssigneeChangedEvent(tenantId = TENANT_A, ticketId = TICKET_1) {
  return {
    eventId: `evt-assign-${ticketId}`,
    tenantId,
    aggregateType: 'ticket',
    aggregateId: ticketId,
    eventType: 'ticket.assignee_changed',
    occurredAt: '2026-01-15T10:20:00Z',
    actorId: AGENT_1,
    payload: {
      ticketId,
      reference: 'TKT-1001',
      subject: 'Cannot access portal',
      priority: 'P2',
      actorDisplayName: 'Alice Agent',
      updatedAt: '2026-01-15T10:20:00Z',
      organizationId: ORG_A1,
    },
  };
}

export function makeTicketResolvedEvent(tenantId = TENANT_A, ticketId = TICKET_1) {
  return {
    eventId: `evt-resolved-${ticketId}`,
    tenantId,
    aggregateType: 'ticket',
    aggregateId: ticketId,
    eventType: 'ticket.resolved',
    occurredAt: '2026-01-15T11:00:00Z',
    actorId: AGENT_1,
    payload: {
      ticketId,
      reference: 'TKT-1001',
      subject: 'Cannot access portal',
      status: 'resolved',
      priority: 'P2',
      actorDisplayName: 'Alice Agent',
      updatedAt: '2026-01-15T11:00:00Z',
      organizationId: ORG_A1,
    },
  };
}

export function makeTicketReopenedEvent(tenantId = TENANT_A, ticketId = TICKET_1) {
  return {
    eventId: `evt-reopened-${ticketId}`,
    tenantId,
    aggregateType: 'ticket',
    aggregateId: ticketId,
    eventType: 'ticket.reopened',
    occurredAt: '2026-01-15T12:00:00Z',
    actorId: AGENT_1,
    payload: {
      ticketId,
      reference: 'TKT-1001',
      subject: 'Cannot access portal',
      status: 'open',
      priority: 'P2',
      actorDisplayName: 'Alice Agent',
      updatedAt: '2026-01-15T12:00:00Z',
      organizationId: ORG_A1,
    },
  };
}

export function makeSlaReminderEvent(tenantId = TENANT_A, ticketId = TICKET_1) {
  return {
    eventId: `evt-sla-reminder-${ticketId}`,
    tenantId,
    aggregateType: 'sla_timer',
    aggregateId: ticketId,
    eventType: 'sla.reminder_threshold_reached',
    occurredAt: '2026-01-15T10:30:00Z',
    actorId: undefined,
    payload: {
      ticketId,
      reference: 'TKT-1001',
      subject: 'Cannot access portal',
      priority: 'P1',
      slaType: 'resolution',
      threshold: 75,
      nextFireAt: '2026-01-15T11:00:00Z',
      timerState: 'running',
      assignmentGroupId: ASSIGNMENT_GROUP_1,
    },
  };
}

export function makeSlaBreachedEvent(tenantId = TENANT_A, ticketId = TICKET_1) {
  return {
    eventId: `evt-sla-breached-${ticketId}`,
    tenantId,
    aggregateType: 'sla_timer',
    aggregateId: ticketId,
    eventType: 'sla.breached',
    occurredAt: '2026-01-15T11:05:00Z',
    actorId: undefined,
    payload: {
      ticketId,
      reference: 'TKT-1001',
      subject: 'Cannot access portal',
      priority: 'P1',
      slaType: 'resolution',
      breachedAt: '2026-01-15T11:05:00Z',
      timerState: 'running',
      assignmentGroupId: ASSIGNMENT_GROUP_1,
    },
  };
}

export function makePausedSlaReminderEvent(tenantId = TENANT_A, ticketId = TICKET_1) {
  return {
    ...makeSlaReminderEvent(tenantId, ticketId),
    payload: {
      ...makeSlaReminderEvent(tenantId, ticketId).payload,
      timerState: 'paused',
    },
  };
}

// ---------------------------------------------------------------------------
// All event fixtures array
// ---------------------------------------------------------------------------

export const ALL_NOTIFICATION_FIXTURES = [
  makeTicketCreatedEvent(),
  makeTicketStatusChangedEvent(),
  makePublicCommentAddedEvent(),
  makeInternalCommentAddedEvent(),
  makeAssigneeChangedEvent(),
  makeTicketResolvedEvent(),
  makeTicketReopenedEvent(),
  makeSlaReminderEvent(),
  makeSlaBreachedEvent(),
];
