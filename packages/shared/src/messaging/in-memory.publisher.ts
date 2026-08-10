/**
 * In-memory publisher adapter.
 *
 * Accumulates published events in an array so tests can assert what was
 * published without any message-bus dependency. Thread-safe for a single
 * JavaScript process (single-threaded event loop).
 *
 * Usage in tests:
 *   const publisher = new InMemoryPublisher();
 *   // ... run drain ...
 *   expect(publisher.events).toHaveLength(1);
 *   expect(publisher.events[0]?.eventType).toBe('ticket.created');
 */
import type { DomainEvent, PublisherPort } from './publisher.port.js';

export class InMemoryPublisher implements PublisherPort {
  readonly name = 'in-memory';

  private readonly _events: DomainEvent[] = [];

  async publish(event: DomainEvent): Promise<void> {
    this._events.push(event);
  }

  /** All events published so far, in insertion order. */
  get events(): ReadonlyArray<DomainEvent> {
    return this._events;
  }

  /** Events grouped by aggregate_id for ordering assertions. */
  eventsForAggregate(aggregateId: string): DomainEvent[] {
    return this._events.filter((e) => e.aggregateId === aggregateId);
  }

  /** Reset the accumulated events. Useful between test cases. */
  reset(): void {
    this._events.length = 0;
  }
}
