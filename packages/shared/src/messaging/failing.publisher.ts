/**
 * Failing publisher adapter — for retry and backoff tests.
 *
 * Throws on every publish call until the configured number of failures is
 * exhausted, then succeeds. Useful for testing the drain loop's retry logic
 * and dead-letter transition without a real message bus.
 */
import type { DomainEvent, PublisherPort } from './publisher.port.js';

export class FailingPublisher implements PublisherPort {
  readonly name = 'failing';

  private failCount: number;
  private readonly publishedAfterFailures: DomainEvent[] = [];

  /**
   * @param failuresBeforeSuccess - Number of calls that will throw before
   *   succeeding. Pass Infinity to always fail (dead-letter tests).
   */
  constructor(private readonly failuresBeforeSuccess: number = Infinity) {
    this.failCount = 0;
  }

  async publish(event: DomainEvent): Promise<void> {
    if (this.failCount < this.failuresBeforeSuccess) {
      this.failCount++;
      throw new Error(`Simulated publish failure #${this.failCount}`);
    }
    this.publishedAfterFailures.push(event);
  }

  get failuresTriggered(): number {
    return this.failCount;
  }

  get successfulEvents(): ReadonlyArray<DomainEvent> {
    return this.publishedAfterFailures;
  }
}
