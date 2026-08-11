/**
 * event-catalogue.ts – canonical source of truth for subscribable webhook event types.
 *
 * Both the management plane (this module) and the delivery worker (WO-084) import
 * from this file so the two can never drift.  The event-catalogue controller projects
 * these records into the public documentation shape.
 */

export interface EventCatalogueEntry {
  readonly eventType: string;
  readonly description: string;
  readonly examplePayload: Record<string, unknown>;
  readonly dataClassification: 'public' | 'internal' | 'restricted';
}

export const EVENT_CATALOGUE: readonly EventCatalogueEntry[] = [
  {
    eventType: 'ticket.created',
    description: 'Fired when a new support ticket is opened.',
    examplePayload: {
      eventType: 'ticket.created',
      tenantId: '00000000-0000-0000-0000-000000000001',
      ticketId: '550e8400-e29b-41d4-a716-446655440000',
      subject: 'Cannot log in',
      status: 'open',
      priority: 'high',
      createdBy: { id: 'usr_001', kind: 'customer' },
      occurredAt: '2024-01-15T09:00:00Z',
    },
    dataClassification: 'internal',
  },
  {
    eventType: 'ticket.updated',
    description: 'Fired when ticket metadata (subject, priority, tags) is changed.',
    examplePayload: {
      eventType: 'ticket.updated',
      tenantId: '00000000-0000-0000-0000-000000000001',
      ticketId: '550e8400-e29b-41d4-a716-446655440000',
      changes: { priority: { from: 'normal', to: 'high' } },
      updatedBy: { id: 'usr_002', kind: 'agent' },
      occurredAt: '2024-01-15T10:00:00Z',
    },
    dataClassification: 'internal',
  },
  {
    eventType: 'ticket.assigned',
    description: 'Fired when a ticket is assigned or reassigned to an agent.',
    examplePayload: {
      eventType: 'ticket.assigned',
      tenantId: '00000000-0000-0000-0000-000000000001',
      ticketId: '550e8400-e29b-41d4-a716-446655440000',
      assignedTo: { id: 'agt_003', kind: 'agent', name: 'Jane Smith' },
      assignedBy: { id: 'usr_002', kind: 'supervisor' },
      occurredAt: '2024-01-15T10:05:00Z',
    },
    dataClassification: 'internal',
  },
  {
    eventType: 'ticket.status_changed',
    description: 'Fired when a ticket transitions between open, pending, on-hold, solved or closed.',
    examplePayload: {
      eventType: 'ticket.status_changed',
      tenantId: '00000000-0000-0000-0000-000000000001',
      ticketId: '550e8400-e29b-41d4-a716-446655440000',
      from: 'open',
      to: 'pending',
      changedBy: { id: 'agt_003', kind: 'agent' },
      occurredAt: '2024-01-15T10:10:00Z',
    },
    dataClassification: 'internal',
  },
  {
    eventType: 'ticket.closed',
    description: 'Fired when a ticket reaches the closed terminal state.',
    examplePayload: {
      eventType: 'ticket.closed',
      tenantId: '00000000-0000-0000-0000-000000000001',
      ticketId: '550e8400-e29b-41d4-a716-446655440000',
      closedBy: { id: 'agt_003', kind: 'agent' },
      satisfactionScore: null,
      occurredAt: '2024-01-15T11:00:00Z',
    },
    dataClassification: 'internal',
  },
  {
    eventType: 'ticket.reopened',
    description: 'Fired when a closed or solved ticket is reopened.',
    examplePayload: {
      eventType: 'ticket.reopened',
      tenantId: '00000000-0000-0000-0000-000000000001',
      ticketId: '550e8400-e29b-41d4-a716-446655440000',
      reopenedBy: { id: 'usr_001', kind: 'customer' },
      reason: 'Issue persists',
      occurredAt: '2024-01-15T14:00:00Z',
    },
    dataClassification: 'internal',
  },
  {
    eventType: 'comment.created',
    description: 'Fired when a public reply or internal note is added to a ticket.',
    examplePayload: {
      eventType: 'comment.created',
      tenantId: '00000000-0000-0000-0000-000000000001',
      ticketId: '550e8400-e29b-41d4-a716-446655440000',
      commentId: 'cmt_00001',
      authorKind: 'agent',
      isPublic: true,
      occurredAt: '2024-01-15T10:30:00Z',
    },
    dataClassification: 'internal',
  },
  {
    eventType: 'webhook.ping',
    description: 'Synthetic test event sent by the POST /{id}/test action. Not fired in production.',
    examplePayload: {
      eventType: 'webhook.ping',
      tenantId: '00000000-0000-0000-0000-000000000001',
      endpointId: '7f000001-0000-0000-0000-000000000001',
      occurredAt: '2024-01-15T12:00:00Z',
    },
    dataClassification: 'public',
  },
] as const;

/** Set of all valid event type strings for O(1) membership tests. */
export const VALID_EVENT_TYPES: ReadonlySet<string> = new Set(
  EVENT_CATALOGUE.map((e) => e.eventType),
);

/**
 * Returns the invalid entries from a caller-supplied list of event type strings.
 * An empty returned array means the entire list is valid.
 */
export function findInvalidEventTypes(eventTypes: string[]): string[] {
  return eventTypes.filter((et) => !VALID_EVENT_TYPES.has(et));
}
