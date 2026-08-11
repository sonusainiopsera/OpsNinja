/**
 * ticket-events.ts — canonical event type constants for the tickets domain.
 *
 * These string literals are written into outbox_events.event_type.
 * Downstream consumers (SLA scheduler, AI synthesis, CSAT) subscribe by
 * event type, so these values must remain stable once deployed.
 *
 * Naming convention: "<aggregate>.<verb>" in snake_case.
 */

export const TICKET_EVENTS = {
  CREATED: 'ticket.created',
  UPDATED: 'ticket.updated',
  STATUS_CHANGED: 'ticket.status_changed',
  PRIORITY_CHANGED: 'ticket.priority_changed',
  ASSIGNED: 'ticket.assigned',
  RESOLVED: 'ticket.resolved',
} as const;

export type TicketEventType = (typeof TICKET_EVENTS)[keyof typeof TICKET_EVENTS];
