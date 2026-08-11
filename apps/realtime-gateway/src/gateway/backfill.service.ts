/**
 * BackfillService — reconnect backfill and snapshot_required gating (WO-069).
 *
 * Protocol (AC5, AC6):
 *  1. Client sends { type:'subscribe', channel:'dashboard', lastSeq: N | null }.
 *  2. If lastSeq is null → send snapshot_required (reason: 'invalid_seq'), done.
 *  3. LRANGE the ring buffer (dash:{tenant}:frames), deserialise, filter seq > lastSeq.
 *  4. If no retained frames exist (Redis restart) → snapshot_required (reason: 'redis_reset').
 *  5. If lastSeq < oldest retained seq → snapshot_required (reason: 'seq_out_of_window').
 *  6. If frame count > MAX_BACKFILL_FRAMES or byte total > MAX_BACKFILL_BYTES
 *     → snapshot_required (reason: 'seq_out_of_window').
 *  7. Otherwise: mark socket as backfilling, send frames in ascending seq order,
 *     then flush the outbound queue (buffered live frames), clear backfilling flag.
 *
 * Live-frame buffering during backfill is handled by the gateway's pubsub
 * dispatch path: when wrapper.backfilling is true, frames are queued in the
 * socket's OutboundQueue rather than sent directly.
 *
 * Metrics emitted as structured log entries:
 *  - backfill_frames_sent
 *  - snapshot_required_total
 */

import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import type Redis from 'ioredis';

// Default: 60 frames (~5 min at 5s) before we force a full snapshot instead of backfill
const MAX_BACKFILL_FRAMES = parseInt(process.env['MAX_BACKFILL_FRAMES'] ?? '60', 10);

import type {
  RedisPublishPayload,
  SnapshotRequiredFrame,
  SnapshotRequiredReason,
  SocketWrapper,
} from './frame.types';
import { OutboundQueue, type SlowConsumerHandler } from './outbound-queue';

// Max total bytes across all backfill frames before we give up and snapshot_required
const MAX_BACKFILL_BYTES = 256 * 1024; // 256 KB

// Ring buffer Redis list key helper (mirrors Keys.frames in dashboard-aggregator)
function framesKey(tenantId: string): string {
  return `dash:${tenantId}:frames`;
}

@Injectable()
export class BackfillService implements SlowConsumerHandler {
  private readonly logger = new Logger(BackfillService.name);

  /** Per-socket outbound queues, keyed by WebSocket instance */
  private readonly queues = new WeakMap<WebSocket, OutboundQueue>();

  /** Counter for slow_consumer_drops_total */
  private slowConsumerDrops = 0;

  constructor(private readonly redis: Redis) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Called when a subscribe message arrives. Manages the backfill handshake.
   * Returns true if the socket was successfully set into live-relay mode,
   * false if snapshot_required was sent.
   */
  async handleSubscribe(
    wrapper: SocketWrapper,
    lastSeq: number | null,
  ): Promise<boolean> {
    const { ws, principal } = wrapper;
    const tenantId = principal.tenantId;

    // ── null lastSeq = first connect with no prior state → snapshot_required ──
    if (lastSeq === null) {
      this.sendSnapshotRequired(ws, tenantId, 'invalid_seq');
      return false;
    }

    // ── Invalid seq (negative or non-integer) ─────────────────────────────────
    if (!Number.isInteger(lastSeq) || lastSeq < 0) {
      this.sendSnapshotRequired(ws, tenantId, 'invalid_seq');
      return false;
    }

    // ── Read ring buffer ──────────────────────────────────────────────────────
    let rawFrames: string[];
    try {
      rawFrames = await this.redis.lrange(framesKey(tenantId), 0, -1);
    } catch (err) {
      this.logger.warn('LRANGE failed during backfill — sending snapshot_required', {
        tenantId,
        principalId: principal.sub,
        error: err instanceof Error ? err.message : String(err),
      });
      this.sendSnapshotRequired(ws, tenantId, 'redis_reset');
      return false;
    }

    // ── Redis restart: ring buffer is empty ───────────────────────────────────
    if (rawFrames.length === 0) {
      this.sendSnapshotRequired(ws, tenantId, 'redis_reset');
      return false;
    }

    // ── Parse and filter frames with seq > lastSeq ────────────────────────────
    const parsed: Array<{ seq: number; json: string }> = [];
    for (const raw of rawFrames) {
      try {
        const f = JSON.parse(raw) as RedisPublishPayload;
        if (typeof f.seq === 'number' && f.seq > lastSeq) {
          parsed.push({ seq: f.seq, json: raw });
        }
      } catch {
        // Malformed frame in ring buffer — skip
      }
    }

    // ── Check if lastSeq is older than the retention window ───────────────────
    if (parsed.length === 0 && rawFrames.length > 0) {
      // Ring buffer has frames but all are ≤ lastSeq — client is caught up
      // (or lastSeq is in the future — could be tampered, treat as caught-up)
      wrapper.subscribed = true;
      wrapper.backfilling = false;
      return true;
    }

    // Oldest retained seq
    const oldestFrame = rawFrames
      .map((r) => { try { return JSON.parse(r) as RedisPublishPayload; } catch { return null; } })
      .filter((f): f is RedisPublishPayload => f !== null)
      .sort((a, b) => a.seq - b.seq)[0];

    if (oldestFrame && lastSeq < oldestFrame.seq - 1) {
      // lastSeq is before the window
      this.sendSnapshotRequired(ws, tenantId, 'seq_out_of_window');
      return false;
    }

    // ── Size gate ─────────────────────────────────────────────────────────────
    const sortedFrames = parsed.sort((a, b) => a.seq - b.seq);

    if (sortedFrames.length > MAX_BACKFILL_FRAMES) {
      this.logger.warn('Backfill exceeds max frame count — sending snapshot_required', {
        tenantId,
        principalId: principal.sub,
        frameCount: sortedFrames.length,
        metric: 'snapshot_required_total',
      });
      this.sendSnapshotRequired(ws, tenantId, 'seq_out_of_window');
      return false;
    }

    const totalBytes = sortedFrames.reduce((sum, f) => sum + f.json.length, 0);
    if (totalBytes > MAX_BACKFILL_BYTES) {
      this.logger.warn('Backfill exceeds max byte budget — sending snapshot_required', {
        tenantId,
        principalId: principal.sub,
        totalBytes,
        metric: 'snapshot_required_total',
      });
      this.sendSnapshotRequired(ws, tenantId, 'seq_out_of_window');
      return false;
    }

    // ── Begin backfill — mark socket so live frames are queued ────────────────
    wrapper.backfilling = true;
    wrapper.subscribed = true;

    // Ensure the outbound queue exists for this socket
    if (!this.queues.has(ws)) {
      this.queues.set(ws, new OutboundQueue(ws, tenantId, principal.sub, this));
    }

    // ── Send backfill frames in ascending seq order ───────────────────────────
    let lastSent = lastSeq;
    for (const frame of sortedFrames) {
      if (ws.readyState !== WebSocket.OPEN) break;
      ws.send(frame.json);
      lastSent = frame.seq;
    }
    wrapper.lastDeliveredSeq = lastSent;

    this.logger.log('Backfill sent', {
      metric: 'backfill_frames_sent',
      tenantId,
      principalId: principal.sub,
      frameCount: sortedFrames.length,
      lastSent,
    });

    // ── Flip to live relay and flush buffered live frames ─────────────────────
    wrapper.backfilling = false;

    const queue = this.queues.get(ws);
    if (queue && !queue.isDropped) {
      const flushed = queue.flush(wrapper.lastDeliveredSeq);
      if (flushed > 0) {
        this.logger.log('Flushed queued live frames after backfill', {
          tenantId,
          principalId: principal.sub,
          flushed,
        });
      }
    }

    return true;
  }

  /**
   * Called by the pub/sub subscriber for each incoming live frame.
   * If the socket is backfilling, enqueue; otherwise send directly.
   * Returns true if delivered, false if queued or socket is slow consumer.
   */
  deliverLiveFrame(
    wrapper: SocketWrapper,
    seq: number,
    json: string,
  ): boolean {
    const { ws } = wrapper;

    if (wrapper.backfilling) {
      const queue = this.getOrCreateQueue(wrapper);
      return queue.enqueue(seq, json);
    }

    // Seq dedup: skip if we already sent this seq
    if (seq <= wrapper.lastDeliveredSeq) {
      return true; // idempotent
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
      wrapper.lastDeliveredSeq = seq;
      return true;
    }
    return false;
  }

  /** Remove the queue for a closed socket. */
  removeSocket(ws: WebSocket): void {
    this.queues.delete(ws);
  }

  /** SlowConsumerHandler implementation */
  onSlowConsumer(tenantId: string, principalId: string): void {
    this.slowConsumerDrops++;
    this.logger.warn('Slow consumer — queue dropped', {
      metric: 'slow_consumer_drops_total',
      tenantId,
      principalId,
      total: this.slowConsumerDrops,
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getOrCreateQueue(wrapper: SocketWrapper): OutboundQueue {
    const { ws, principal } = wrapper;
    if (!this.queues.has(ws)) {
      this.queues.set(
        ws,
        new OutboundQueue(ws, principal.tenantId, principal.sub, this),
      );
    }
    return this.queues.get(ws)!;
  }

  private sendSnapshotRequired(
    ws: WebSocket,
    tenantId: string,
    reason: SnapshotRequiredReason,
  ): void {
    this.logger.log('Sending snapshot_required', {
      metric: 'snapshot_required_total',
      tenantId,
      reason,
    });

    const frame: SnapshotRequiredFrame = {
      type: 'snapshot_required',
      tenantId,
      reason,
    };

    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        // Socket may have closed
      }
    }
  }
}
