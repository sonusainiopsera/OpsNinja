/**
 * Unit tests for the eventual-consistency polling utility.
 *
 * Tests:
 *   - eventually() resolves immediately when condition is already true
 *   - eventually() polls until condition becomes true
 *   - eventually() throws descriptive error when timeout expires
 *   - eventualValue() returns the first value satisfying predicate
 *   - eventualValue() includes last observed value in error message
 *   - computeExpectedQueue() filters and returns correct ID set
 */

import { describe, it, expect, vi } from 'vitest';
import { eventually, eventualValue, computeExpectedQueue } from '../support/eventual';

describe('eventually()', () => {
  it('resolves immediately when condition is already true', async () => {
    await expect(
      eventually(() => true, { description: 'already true', timeoutMs: 1_000 }),
    ).resolves.toBeUndefined();
  });

  it('polls until condition becomes true', async () => {
    let calls = 0;
    await eventually(
      () => {
        calls++;
        return calls >= 3;
      },
      { description: 'after 3 calls', timeoutMs: 2_000, initialIntervalMs: 10 },
    );
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('throws with descriptive error when timeout expires', async () => {
    await expect(
      eventually(() => false, {
        description: 'the impossible condition',
        timeoutMs: 100,
        initialIntervalMs: 10,
      }),
    ).rejects.toThrow('the impossible condition');
  });

  it('error message includes elapsed time', async () => {
    const err = await eventually(() => false, {
      description: 'timeout test',
      timeoutMs: 100,
      initialIntervalMs: 10,
    }).catch((e: Error) => e);
    expect(err.message).toContain('100ms');
  });

  it('catches and retries when condition throws', async () => {
    let calls = 0;
    await eventually(
      () => {
        calls++;
        if (calls < 3) throw new Error('not ready yet');
        return true;
      },
      { description: 'recovers from throws', timeoutMs: 2_000, initialIntervalMs: 10 },
    );
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});

describe('eventualValue()', () => {
  it('returns the first value satisfying the predicate', async () => {
    let counter = 0;
    const result = await eventualValue(
      async () => ({ count: ++counter }),
      (v) => v.count >= 5,
      { description: 'counter reaches 5', timeoutMs: 2_000, initialIntervalMs: 10 },
    );
    expect(result.count).toBeGreaterThanOrEqual(5);
  });

  it('includes last observed value in timeout error', async () => {
    const err = await eventualValue(
      async () => ({ status: 'pending' }),
      (v) => v.status === 'done',
      {
        description: 'status becomes done',
        timeoutMs: 100,
        initialIntervalMs: 10,
      },
    ).catch((e: Error) => e);
    expect((err as Error).message).toContain('pending');
  });

  it('throws with description when timeout expires', async () => {
    await expect(
      eventualValue(
        async () => 42,
        (v) => v > 100,
        { description: 'value exceeds 100', timeoutMs: 100, initialIntervalMs: 10 },
      ),
    ).rejects.toThrow('value exceeds 100');
  });
});

describe('computeExpectedQueue()', () => {
  const tickets = [
    { id: 'a', status: 'open', priority: 'P1' },
    { id: 'b', status: 'open', priority: 'P2' },
    { id: 'c', status: 'resolved', priority: 'P1' },
    { id: 'd', status: 'open', priority: 'P3' },
  ];

  it('returns matching ticket IDs', () => {
    const result = computeExpectedQueue(
      tickets,
      (t) => t.status === 'open' && (t.priority === 'P1' || t.priority === 'P2'),
    );
    expect(result).toEqual(new Set(['a', 'b']));
  });

  it('returns empty set when no tickets match', () => {
    const result = computeExpectedQueue(tickets, () => false);
    expect(result.size).toBe(0);
  });

  it('returns all IDs when all match', () => {
    const result = computeExpectedQueue(tickets, () => true);
    expect(result.size).toBe(4);
  });

  it('preserves referential identity of ticket IDs', () => {
    const result = computeExpectedQueue(tickets, (t) => t.id === 'c');
    expect(result.has('c')).toBe(true);
  });
});
