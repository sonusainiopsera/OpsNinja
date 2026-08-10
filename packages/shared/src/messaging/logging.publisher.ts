/**
 * Logging publisher adapter — for local development.
 *
 * Emits a structured JSON log line for each event instead of calling a real
 * message bus. Useful during early development and for debugging event flows.
 */
import type { DomainEvent, PublisherPort } from './publisher.port.js';

export class LoggingPublisher implements PublisherPort {
  readonly name = 'logging';

  async publish(event: DomainEvent): Promise<void> {
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'outbox.event.published',
        eventId: event.id,
        tenantId: event.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        occurredAt: event.occurredAt.toISOString(),
      }),
    );
  }
}
