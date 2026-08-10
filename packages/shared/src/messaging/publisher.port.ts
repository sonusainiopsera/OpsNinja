/**
 * Publisher port — the interface all publish adapters must implement.
 *
 * Delivery semantics: at-least-once. Consumers must be idempotent and use
 * the event `id` field as their deduplication key. See docs/events.md.
 *
 * Provider substitution is a configuration change: swap the adapter bound
 * to this port without touching any business logic.
 */

/** Shape of a domain event delivered through the publisher port. */
export interface DomainEvent {
  /** Stable UUID used by consumers for at-least-once deduplication. */
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  /** Wall-clock time the event was created (not published). */
  occurredAt: Date;
}

/**
 * Publisher port interface.
 *
 * Implementations must be safe to call concurrently from multiple drain
 * loop iterations. Throwing an error from `publish` signals delivery failure
 * and causes the drain loop to increment the retry counter.
 */
export interface PublisherPort {
  /**
   * Publish a single domain event.
   *
   * @throws Any error signals delivery failure; the drain loop handles retries.
   */
  publish(event: DomainEvent): Promise<void>;

  /** Human-readable adapter name for logging and metrics labelling. */
  readonly name: string;
}
