/**
 * OutboundQueue — bounded per-socket frame queue with backpressure (WO-069).
 *
 * Design:
 *  - Each socket gets one queue instance.
 *  - Frames are enqueued while backfill is in progress or the socket send buffer
 *    is temporarily busy.
 *  - Once the queue depth exceeds MAX_DEPTH, the socket is declared a slow
 *    consumer: a snapshot_required frame is sent, the queue is dropped, and the
 *    slow_consumer_drops_total metric is emitted.
 *  - Seq-based deduplication: a frame whose seq has already been delivered is
 *    silently discarded from the queue (prevents replay of an already-sent seq
 *    after backfill completes).
 *
 * This class is deliberately framework-free so it can be unit-tested without
 * NestJS bootstrapping.
 */

import { WebSocket } from 'ws';
import type { SnapshotRequiredFrame } from './frame.types';

export const OUTBOUND_QUEUE_MAX_DEPTH = parseInt(
  process.env['OUTBOUND_QUEUE_MAX_DEPTH'] ?? '200',
  10,
);

export interface QueuedFrame {
  seq: number;
  json: string;
}

export interface SlowConsumerHandler {
  onSlowConsumer(tenantId: string, principalId: string): void;
}

export class OutboundQueue {
  private readonly frames: QueuedFrame[] = [];
  private dropped = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly tenantId: string,
    private readonly principalId: string,
    private readonly slowConsumerHandler: SlowConsumerHandler,
    private readonly maxDepth = OUTBOUND_QUEUE_MAX_DEPTH,
  ) {}

  /** True when the queue was dropped due to slow consumer. */
  get isDropped(): boolean {
    return this.dropped;
  }

  /** Current queue depth. */
  get depth(): number {
    return this.frames.length;
  }

  /**
   * Enqueue a frame. Returns false if the socket is a slow consumer
   * and the queue was just dropped.
   */
  enqueue(seq: number, json: string): boolean {
    if (this.dropped) return false;

    if (this.frames.length >= this.maxDepth) {
      this.handleSlowConsumer();
      return false;
    }

    this.frames.push({ seq, json });
    return true;
  }

  /**
   * Flush frames to the socket whose seq is > lastDeliveredSeq,
   * in ascending order, deduplicating by seq.
   *
   * Returns the number of frames actually sent.
   */
  flush(lastDeliveredSeq: number): number {
    if (this.dropped) return 0;

    let sent = 0;
    let highWater = lastDeliveredSeq;

    // Sort by seq so we deliver in ascending order
    this.frames.sort((a, b) => a.seq - b.seq);

    for (const frame of this.frames) {
      if (frame.seq <= highWater) {
        // Already delivered — discard
        continue;
      }
      if (frame.seq !== highWater + 1) {
        // Gap detected — skip frames we can't safely deliver in order
        // The socket should ask for snapshot_required; but we can still
        // deliver contiguous frames that follow.
        // In practice this should not happen as the publisher fills the ring
        // buffer with contiguous seqs.
        break;
      }
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(frame.json);
        highWater = frame.seq;
        sent++;
      }
    }

    // Clear flushed frames
    this.frames.length = 0;
    return sent;
  }

  /** Flush without sequence ordering checks (e.g., after a snapshot delivery). */
  flushUnordered(lastDeliveredSeq: number): number {
    if (this.dropped) return 0;

    let sent = 0;
    // Sort ascending
    this.frames.sort((a, b) => a.seq - b.seq);

    for (const frame of this.frames) {
      if (frame.seq <= lastDeliveredSeq) continue;
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(frame.json);
        sent++;
      }
    }
    this.frames.length = 0;
    return sent;
  }

  /** Discard all queued frames without sending. */
  clear(): void {
    this.frames.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private handleSlowConsumer(): void {
    this.dropped = true;
    this.frames.length = 0;

    // Notify the handler first (for metrics / logging)
    this.slowConsumerHandler.onSlowConsumer(this.tenantId, this.principalId);

    // Send snapshot_required to the socket
    const frame: SnapshotRequiredFrame = {
      type: 'snapshot_required',
      tenantId: this.tenantId,
      reason: 'slow_consumer',
    };

    if (this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(frame));
      } catch {
        // Socket may have closed; ignore send error
      }
    }
  }
}
