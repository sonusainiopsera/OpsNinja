/**
 * Unit tests for OutboundQueue — WO-069 AC10
 *
 * Covers:
 *  - enqueue: adds frames up to maxDepth
 *  - enqueue: returns false and drops queue on overflow (slow consumer)
 *  - enqueue: sends snapshot_required to socket on overflow
 *  - flush: delivers frames in ascending seq order skipping already-delivered
 *  - flush: seq-based deduplication (frames ≤ lastDeliveredSeq silently skipped)
 *  - flush: gap detection stops flush at non-contiguous seq
 *  - isDropped: true after overflow, enqueue ignored on dropped queue
 *  - depth: reflects current queue length
 *  - clear: drains queue without sending
 *  - flushUnordered: delivers all frames above lastDeliveredSeq without contiguity check
 */

import { WebSocket } from 'ws';
import { OutboundQueue, OUTBOUND_QUEUE_MAX_DEPTH, type SlowConsumerHandler } from '../outbound-queue';
import type { SnapshotRequiredFrame } from '../frame.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-test-001';
const PRINCIPAL_ID = 'user-test-001';

function makeSocket(): { ws: WebSocket; sent: string[] } {
  const sent: string[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    send: jest.fn((data: string) => sent.push(data)),
  } as unknown as WebSocket;
  return { ws, sent };
}

function makeClosedSocket(): { ws: WebSocket; sent: string[] } {
  const sent: string[] = [];
  const ws = {
    readyState: WebSocket.CLOSED,
    send: jest.fn((data: string) => sent.push(data)),
  } as unknown as WebSocket;
  return { ws, sent };
}

function makeSlowConsumerHandler(): {
  handler: SlowConsumerHandler;
  calls: Array<{ tenantId: string; principalId: string }>;
} {
  const calls: Array<{ tenantId: string; principalId: string }> = [];
  const handler: SlowConsumerHandler = {
    onSlowConsumer: (tenantId, principalId) => calls.push({ tenantId, principalId }),
  };
  return { handler, calls };
}

function makeQueue(maxDepth = OUTBOUND_QUEUE_MAX_DEPTH): {
  queue: OutboundQueue;
  ws: WebSocket;
  sent: string[];
  handler: SlowConsumerHandler;
  slowCalls: Array<{ tenantId: string; principalId: string }>;
} {
  const { ws, sent } = makeSocket();
  const { handler, calls: slowCalls } = makeSlowConsumerHandler();
  const queue = new OutboundQueue(ws, TENANT_ID, PRINCIPAL_ID, handler, maxDepth);
  return { queue, ws, sent, handler, slowCalls };
}

function makeFrame(seq: number): string {
  return JSON.stringify({ type: 'delta', tenantId: TENANT_ID, seq, prevSeq: seq - 1 });
}

// ---------------------------------------------------------------------------
// enqueue — basic behaviour
// ---------------------------------------------------------------------------

describe('OutboundQueue.enqueue — basic', () => {
  it('accepts frames up to maxDepth', () => {
    const { queue } = makeQueue(3);
    expect(queue.enqueue(1, makeFrame(1))).toBe(true);
    expect(queue.enqueue(2, makeFrame(2))).toBe(true);
    expect(queue.enqueue(3, makeFrame(3))).toBe(true);
    expect(queue.depth).toBe(3);
    expect(queue.isDropped).toBe(false);
  });

  it('returns false and drops queue when depth exceeds maxDepth', () => {
    const { queue } = makeQueue(2);
    queue.enqueue(1, makeFrame(1));
    queue.enqueue(2, makeFrame(2));
    // Third enqueue exceeds limit
    const result = queue.enqueue(3, makeFrame(3));
    expect(result).toBe(false);
    expect(queue.isDropped).toBe(true);
  });

  it('sends snapshot_required to socket on overflow', () => {
    const { queue, sent } = makeQueue(1);
    queue.enqueue(1, makeFrame(1));
    queue.enqueue(2, makeFrame(2)); // triggers overflow

    expect(sent.length).toBe(1);
    const frame = JSON.parse(sent[0]!) as SnapshotRequiredFrame;
    expect(frame.type).toBe('snapshot_required');
    expect(frame.tenantId).toBe(TENANT_ID);
    expect(frame.reason).toBe('slow_consumer');
  });

  it('notifies the slow consumer handler on overflow', () => {
    const { queue, slowCalls } = makeQueue(1);
    queue.enqueue(1, makeFrame(1));
    queue.enqueue(2, makeFrame(2));

    expect(slowCalls).toHaveLength(1);
    expect(slowCalls[0]!.tenantId).toBe(TENANT_ID);
    expect(slowCalls[0]!.principalId).toBe(PRINCIPAL_ID);
  });

  it('returns false immediately on further enqueue after drop', () => {
    const { queue } = makeQueue(1);
    queue.enqueue(1, makeFrame(1));
    queue.enqueue(2, makeFrame(2)); // drop
    const result = queue.enqueue(3, makeFrame(3));
    expect(result).toBe(false);
    expect(queue.depth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// flush — ordered delivery
// ---------------------------------------------------------------------------

describe('OutboundQueue.flush — ordered delivery', () => {
  it('delivers frames in ascending seq order', () => {
    const { queue, sent } = makeQueue();
    // Enqueue out of order
    queue.enqueue(3, makeFrame(3));
    queue.enqueue(1, makeFrame(1));
    queue.enqueue(2, makeFrame(2));

    const flushed = queue.flush(0);
    expect(flushed).toBe(3);
    expect(sent).toHaveLength(3);
    // Verify ascending order
    const seqs = sent.map((s) => (JSON.parse(s) as { seq: number }).seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it('skips frames with seq ≤ lastDeliveredSeq', () => {
    const { queue, sent } = makeQueue();
    queue.enqueue(1, makeFrame(1));
    queue.enqueue(2, makeFrame(2));
    queue.enqueue(3, makeFrame(3));

    const flushed = queue.flush(2); // already delivered up to seq=2
    expect(flushed).toBe(1);
    expect(sent).toHaveLength(1);
    expect((JSON.parse(sent[0]!) as { seq: number }).seq).toBe(3);
  });

  it('stops at a seq gap', () => {
    const { queue, sent } = makeQueue();
    queue.enqueue(1, makeFrame(1));
    queue.enqueue(2, makeFrame(2));
    queue.enqueue(4, makeFrame(4)); // gap: seq 3 missing

    const flushed = queue.flush(0);
    expect(flushed).toBe(2);
    expect(sent).toHaveLength(2);
  });

  it('clears the queue after flush', () => {
    const { queue } = makeQueue();
    queue.enqueue(1, makeFrame(1));
    queue.flush(0);
    expect(queue.depth).toBe(0);
  });

  it('returns 0 on dropped queue', () => {
    const { queue, sent } = makeQueue(1);
    queue.enqueue(1, makeFrame(1));
    queue.enqueue(2, makeFrame(2)); // drop
    const flushed = queue.flush(0);
    expect(flushed).toBe(0);
    // snapshot_required was already sent by overflow handler; no extra frames
    expect(sent).toHaveLength(1); // just the snapshot_required
  });

  it('does not send to a closed socket', () => {
    const { ws, sent } = makeClosedSocket();
    const { handler } = makeSlowConsumerHandler();
    const queue = new OutboundQueue(ws, TENANT_ID, PRINCIPAL_ID, handler);
    queue.enqueue(1, makeFrame(1));
    const flushed = queue.flush(0);
    expect(flushed).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// flushUnordered
// ---------------------------------------------------------------------------

describe('OutboundQueue.flushUnordered', () => {
  it('delivers all frames above lastDeliveredSeq without contiguity check', () => {
    const { queue, sent } = makeQueue();
    queue.enqueue(1, makeFrame(1));
    queue.enqueue(3, makeFrame(3)); // gap — would stop flush()
    queue.enqueue(5, makeFrame(5));

    const flushed = queue.flushUnordered(0);
    expect(flushed).toBe(3);
    expect(sent).toHaveLength(3);
  });

  it('skips frames with seq ≤ lastDeliveredSeq', () => {
    const { queue, sent } = makeQueue();
    queue.enqueue(1, makeFrame(1));
    queue.enqueue(2, makeFrame(2));
    queue.enqueue(3, makeFrame(3));

    const flushed = queue.flushUnordered(2);
    expect(flushed).toBe(1);
    expect(sent).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// depth and clear
// ---------------------------------------------------------------------------

describe('OutboundQueue — depth and clear', () => {
  it('depth reflects queued frame count', () => {
    const { queue } = makeQueue();
    expect(queue.depth).toBe(0);
    queue.enqueue(1, makeFrame(1));
    expect(queue.depth).toBe(1);
    queue.enqueue(2, makeFrame(2));
    expect(queue.depth).toBe(2);
  });

  it('clear empties queue without sending frames', () => {
    const { queue, sent } = makeQueue();
    queue.enqueue(1, makeFrame(1));
    queue.enqueue(2, makeFrame(2));
    queue.clear();
    expect(queue.depth).toBe(0);
    // No frames sent
    expect(sent).toHaveLength(0);
  });

  it('isDropped starts false', () => {
    const { queue } = makeQueue();
    expect(queue.isDropped).toBe(false);
  });
});
