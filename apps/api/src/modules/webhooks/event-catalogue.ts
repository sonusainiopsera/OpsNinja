/**
 * Webhook event catalogue — single source of truth for publishable event types.
 *
 * This array is shared by:
 *  - EventCatalogueController  → GET /api/v1/webhooks/event-types (public docs)
 *  - WebhookEndpointsService   → validates event_types on create/patch
 *
 * Adding a new event type here makes it available to both.
 * Never duplicate this list into a separate string array.
 */

export interface EventCatalogueEntry {
  eventType: string;
  description: string;
  examplePayload: Record<string, unknown>;
  dataClassification: 'public' | 'internal' | 'confidential';
}

export const EVENT_CATALOGUE: readonly EventCatalogueEntry[] = [
  {
    eventType: 'ticket.created',
    description: 'Fired when a new support ticket is created.',
    examplePayload: {
      id: '01910f2a-0000-7000-8000-000000000001',
      subject: 'Cannot connect to VPN',
      status: 'open',
      priority: 'P2',
      organizationId: '01910f2a-0000-7000-8000-000000000002',
      createdAt: '2026-01-01T00:00:00Z',
    },
    dataClassification: 'internal',
  },
  {
    eventType: 'ticket.updated',
    description: 'Fired when a ticket field is changed (status, priority, assignee, subject).',
    examplePayload: {
      id: '01910f2a-0000-7000-8000-000000000001',
      changes: { status: { from: 'open', to: 'in_progress' } },
      updatedAt: '2026-01-01T01:00:00Z',
    },
    dataClassification: 'internal',
  },
  {
    eventType: 'ticket.closed',
    description: 'Fired when a ticket transitions to closed or resolved status.',
    examplePayload: {
      id: '01910f2a-0000-7000-8000-000000000001',
      resolvedAt: '2026-01-01T02:00:00Z',
      resolution: 'resolved',
    },
    dataClassification: 'internal',
  },
  {
    eventType: 'ticket.comment_added',
    description: 'Fired when a public comment is added to a ticket.',
    examplePayload: {
      ticketId: '01910f2a-0000-7000-8000-000000000001',
      commentId: '01910f2a-0000-7000-8000-000000000003',
      visibility: 'public',
      createdAt: '2026-01-01T01:30:00Z',
    },
    dataClassification: 'internal',
  },
  {
    eventType: 'ticket.sla_breached',
    description: 'Fired when a ticket breaches its SLA response or resolution target.',
    examplePayload: {
      ticketId: '01910f2a-0000-7000-8000-000000000001',
      slaType: 'resolution',
      priority: 'P1',
      breachedAt: '2026-01-01T04:00:00Z',
    },
    dataClassification: 'internal',
  },
  {
    eventType: 'ticket.assigned',
    description: 'Fired when a ticket is assigned or reassigned to an agent.',
    examplePayload: {
      ticketId: '01910f2a-0000-7000-8000-000000000001',
      assigneeId: '01910f2a-0000-7000-8000-000000000010',
      assignedAt: '2026-01-01T00:10:00Z',
    },
    dataClassification: 'internal',
  },
  {
    eventType: 'webhook.ping',
    description: 'Synthetic ping event sent by the test-fire action to verify endpoint reachability.',
    examplePayload: {
      event: 'webhook.ping',
      timestamp: '2026-01-01T00:00:00Z',
    },
    dataClassification: 'public',
  },
];

/** Set of valid event type strings, derived from the catalogue. */
export const VALID_EVENT_TYPES: ReadonlySet<string> = new Set(
  EVENT_CATALOGUE.map((e) => e.eventType),
);

/** Check whether a given event type string is in the catalogue. */
export function isValidEventType(eventType: string): boolean {
  return VALID_EVENT_TYPES.has(eventType);
}
