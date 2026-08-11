/**
 * Shared event-type registry — single source of truth for all outbound webhook events.
 *
 * This registry is consumed by:
 *  - apps/api/src/modules/webhooks/event-catalogue.ts  (public REST endpoint)
 *  - apps/workers/webhook-worker                        (delivery validation)
 *  - docs/scripts/generate-webhook-catalogue.ts         (documentation generator)
 *
 * Every event emitted by the outbox MUST have an entry here with a payload
 * schema and example payload. The build gate in test/docs/portal-coverage.spec.ts
 * fails when any entry lacks a payloadSchema.
 *
 * Feature-flagged events must set availability: 'unavailable' rather than being
 * omitted — this ensures they render with a clear notice rather than silently missing.
 */

export type DataClassification = 'public' | 'internal' | 'confidential';
export type DeliveryGuarantee = 'at-least-once';
export type EventAvailability = 'available' | 'unavailable';

/** JSON Schema subset sufficient for documentation generation. */
export interface JsonSchemaObject {
  type: 'object';
  description?: string;
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface JsonSchemaProperty {
  type: string | string[];
  description?: string;
  format?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface EventRegistryEntry {
  /** Dot-namespaced event type name, e.g. "ticket.created". */
  eventType: string;
  /** Human-readable summary for the catalogue index page. */
  description: string;
  /** Condition that causes this event to be emitted. */
  trigger: string;
  /** Primary resource affected by this event. */
  resource: string;
  /** Delivery guarantee provided by the outbox + SQS pipeline. */
  deliveryGuarantee: DeliveryGuarantee;
  /** Note on ordering behaviour. */
  orderingCaveat: string;
  /** Visibility classification for documentation and subscription eligibility. */
  dataClassification: DataClassification;
  /**
   * Whether the event is currently available for subscription.
   * Feature-flagged events should be marked 'unavailable' rather than omitted.
   */
  availability: EventAvailability;
  /**
   * JSON Schema for the `data` object within the canonical event envelope.
   * A missing or empty schema fails the documentation build gate.
   */
  payloadSchema: JsonSchemaObject;
  /**
   * Synthetic example `data` object matching payloadSchema.
   * Must use placeholder tenant IDs and no real domains.
   */
  examplePayload: Record<string, unknown>;
}

export const EVENT_REGISTRY: readonly EventRegistryEntry[] = [
  {
    eventType: 'ticket.created',
    description: 'Emitted when a new support ticket is created by any ingestion channel.',
    trigger: 'A ticket row is inserted and the enclosing transaction commits.',
    resource: 'ticket',
    deliveryGuarantee: 'at-least-once',
    orderingCaveat:
      'Multiple ticket.created events may be delivered out of creation order when the outbox drain processes a backlog batch. Consumers should use the occurredAt field, not arrival order, for sequencing.',
    dataClassification: 'internal',
    availability: 'available',
    payloadSchema: {
      type: 'object',
      description: 'Data for the ticket.created event.',
      properties: {
        id: { type: 'string', format: 'uuid', description: 'Ticket identifier.' },
        subject: { type: 'string', description: 'Ticket subject line.' },
        status: {
          type: 'string',
          enum: ['open', 'in_progress', 'pending', 'resolved', 'closed'],
          description: 'Initial ticket status.',
        },
        priority: {
          type: 'string',
          enum: ['P1', 'P2', 'P3', 'P4'],
          description: 'Ticket priority.',
        },
        organizationId: { type: 'string', format: 'uuid', description: 'Organization that owns the ticket.' },
        createdAt: { type: 'string', format: 'date-time', description: 'ISO 8601 creation timestamp.' },
      },
      required: ['id', 'subject', 'status', 'priority', 'organizationId', 'createdAt'],
    },
    examplePayload: {
      id: '01910f2a-0000-7000-8000-000000000001',
      subject: 'Cannot connect to VPN',
      status: 'open',
      priority: 'P2',
      organizationId: '01910f2a-0000-7000-8000-000000000002',
      createdAt: '2026-01-01T00:00:00Z',
    },
  },
  {
    eventType: 'ticket.updated',
    description: 'Emitted when a ticket field is changed (status, priority, assignee, or subject).',
    trigger: 'A ticket row is updated with at least one tracked field changing value.',
    resource: 'ticket',
    deliveryGuarantee: 'at-least-once',
    orderingCaveat:
      'Rapid successive updates to the same ticket may be delivered as separate events or coalesced depending on outbox drain timing. Idempotency key is the outbox event ID; consumers must tolerate duplicate delivery.',
    dataClassification: 'internal',
    availability: 'available',
    payloadSchema: {
      type: 'object',
      description: 'Data for the ticket.updated event.',
      properties: {
        id: { type: 'string', format: 'uuid', description: 'Ticket identifier.' },
        changes: {
          type: 'object',
          description: 'Map of changed fields to {from, to} pairs.',
          properties: {},
        },
        updatedAt: { type: 'string', format: 'date-time', description: 'ISO 8601 update timestamp.' },
      },
      required: ['id', 'changes', 'updatedAt'],
    },
    examplePayload: {
      id: '01910f2a-0000-7000-8000-000000000001',
      changes: { status: { from: 'open', to: 'in_progress' } },
      updatedAt: '2026-01-01T01:00:00Z',
    },
  },
  {
    eventType: 'ticket.closed',
    description: 'Emitted when a ticket transitions to the closed or resolved status.',
    trigger: 'A ticket status field is set to "resolved" or "closed".',
    resource: 'ticket',
    deliveryGuarantee: 'at-least-once',
    orderingCaveat:
      'ticket.closed is always emitted after ticket.updated for the same state change. Consumers that process ticket.updated need not also process ticket.closed unless they require the richer closed payload.',
    dataClassification: 'internal',
    availability: 'available',
    payloadSchema: {
      type: 'object',
      description: 'Data for the ticket.closed event.',
      properties: {
        id: { type: 'string', format: 'uuid', description: 'Ticket identifier.' },
        resolvedAt: { type: 'string', format: 'date-time', description: 'ISO 8601 resolution timestamp.' },
        resolution: {
          type: 'string',
          enum: ['resolved', 'closed', 'duplicate', 'wont_fix'],
          description: 'Resolution disposition.',
        },
      },
      required: ['id', 'resolvedAt', 'resolution'],
    },
    examplePayload: {
      id: '01910f2a-0000-7000-8000-000000000001',
      resolvedAt: '2026-01-01T02:00:00Z',
      resolution: 'resolved',
    },
  },
  {
    eventType: 'ticket.comment_added',
    description: 'Emitted when a public comment is added to a ticket.',
    trigger: 'A comment row with visibility="public" is inserted.',
    resource: 'comment',
    deliveryGuarantee: 'at-least-once',
    orderingCaveat:
      'Internal (agent-only) comments never trigger this event. Consumers should not infer comment numbering from delivery order.',
    dataClassification: 'internal',
    availability: 'available',
    payloadSchema: {
      type: 'object',
      description: 'Data for the ticket.comment_added event.',
      properties: {
        ticketId: { type: 'string', format: 'uuid', description: 'Parent ticket identifier.' },
        commentId: { type: 'string', format: 'uuid', description: 'Comment identifier.' },
        visibility: { type: 'string', enum: ['public'], description: 'Always "public" for this event.' },
        createdAt: { type: 'string', format: 'date-time', description: 'ISO 8601 comment creation timestamp.' },
      },
      required: ['ticketId', 'commentId', 'visibility', 'createdAt'],
    },
    examplePayload: {
      ticketId: '01910f2a-0000-7000-8000-000000000001',
      commentId: '01910f2a-0000-7000-8000-000000000003',
      visibility: 'public',
      createdAt: '2026-01-01T01:30:00Z',
    },
  },
  {
    eventType: 'ticket.sla_breached',
    description: 'Emitted when a ticket breaches its SLA response or resolution target.',
    trigger: 'The SLA timer scheduler detects a timer past its next_fire_at deadline.',
    resource: 'ticket',
    deliveryGuarantee: 'at-least-once',
    orderingCaveat:
      'SLA breach events are generated by the scheduler tick (every 15 seconds). A ticket that is resolved before the scheduler runs will not generate a breach event even if the deadline has passed.',
    dataClassification: 'internal',
    availability: 'available',
    payloadSchema: {
      type: 'object',
      description: 'Data for the ticket.sla_breached event.',
      properties: {
        ticketId: { type: 'string', format: 'uuid', description: 'Ticket identifier.' },
        slaType: {
          type: 'string',
          enum: ['response', 'resolution'],
          description: 'Which SLA target was breached.',
        },
        priority: {
          type: 'string',
          enum: ['P1', 'P2', 'P3', 'P4'],
          description: 'Ticket priority at time of breach.',
        },
        breachedAt: { type: 'string', format: 'date-time', description: 'ISO 8601 breach detection timestamp.' },
      },
      required: ['ticketId', 'slaType', 'priority', 'breachedAt'],
    },
    examplePayload: {
      ticketId: '01910f2a-0000-7000-8000-000000000001',
      slaType: 'resolution',
      priority: 'P1',
      breachedAt: '2026-01-01T04:00:00Z',
    },
  },
  {
    eventType: 'ticket.assigned',
    description: 'Emitted when a ticket is assigned or reassigned to an agent.',
    trigger: 'The ticket assignee_id field is set or changed.',
    resource: 'ticket',
    deliveryGuarantee: 'at-least-once',
    orderingCaveat:
      'Reassignment emits one ticket.assigned event; the previous assignment is visible only in the changes field of the accompanying ticket.updated event.',
    dataClassification: 'internal',
    availability: 'available',
    payloadSchema: {
      type: 'object',
      description: 'Data for the ticket.assigned event.',
      properties: {
        ticketId: { type: 'string', format: 'uuid', description: 'Ticket identifier.' },
        assigneeId: { type: 'string', format: 'uuid', description: 'Agent user identifier.' },
        assignedAt: { type: 'string', format: 'date-time', description: 'ISO 8601 assignment timestamp.' },
      },
      required: ['ticketId', 'assigneeId', 'assignedAt'],
    },
    examplePayload: {
      ticketId: '01910f2a-0000-7000-8000-000000000001',
      assigneeId: '01910f2a-0000-7000-8000-000000000010',
      assignedAt: '2026-01-01T00:10:00Z',
    },
  },
  {
    eventType: 'webhook.ping',
    description: 'Synthetic ping sent by the test-fire action to verify endpoint reachability.',
    trigger: 'Operator or integration user invokes the test-fire endpoint for a webhook subscription.',
    resource: 'webhook_endpoint',
    deliveryGuarantee: 'at-least-once',
    orderingCaveat: 'Ping events are not correlated with other event types and carry no business data.',
    dataClassification: 'public',
    availability: 'available',
    payloadSchema: {
      type: 'object',
      description: 'Data for the webhook.ping event.',
      properties: {
        event: { type: 'string', enum: ['webhook.ping'], description: 'Literal "webhook.ping".' },
        timestamp: { type: 'string', format: 'date-time', description: 'ISO 8601 ping generation timestamp.' },
      },
      required: ['event', 'timestamp'],
    },
    examplePayload: {
      event: 'webhook.ping',
      timestamp: '2026-01-01T00:00:00Z',
    },
  },
];

/** Set of all registered event type strings. */
export const REGISTERED_EVENT_TYPES: ReadonlySet<string> = new Set(
  EVENT_REGISTRY.map((e) => e.eventType),
);

/** Look up a registry entry by event type name. Returns undefined if not found. */
export function getRegistryEntry(eventType: string): EventRegistryEntry | undefined {
  return EVENT_REGISTRY.find((e) => e.eventType === eventType);
}

/** Returns true if an event type is registered. */
export function isRegisteredEventType(eventType: string): boolean {
  return REGISTERED_EVENT_TYPES.has(eventType);
}

/** Returns only available (non-feature-flagged) event entries. */
export function getAvailableEntries(): readonly EventRegistryEntry[] {
  return EVENT_REGISTRY.filter((e) => e.availability === 'available');
}
