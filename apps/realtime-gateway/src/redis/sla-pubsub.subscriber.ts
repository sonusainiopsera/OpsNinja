/**
 * SlaPubSubSubscriber — batches SLA clock updates into 5-second delta frames (WO-050).
 *
 * The SLA scheduler and pause/resume paths publish per-tenant Redis pub/sub
 * messages under the `sla:{tenantId}` channel. This subscriber:
 *   1. Subscribes to pattern `sla:*` on a dedicated Redis connection.
 *   2. Accumulates incoming items per tenant in memory.
 *   3. Every 5 seconds, flushes each tenant's buffer as a `sla.delta` frame
 *      to all subscribed, tenant-matching sockets.
 *   4. Within each flush, deduplicates by (ticketId, clockType), keeping the
 *      most recent item (highest computedAt).
 *
 * Frame pushed to clients:
 *   { type: 'sla.delta', tenantId, seq, sentAt, items: [...] }
 *
 * Staleness guard: a client that receives no frames for >30 s should switch to
 * polling (enforced in the `useSlaLiveUpdates` hook).
 *
 * Error handling:
 * - Redis connection loss: marks ready=false; ioredis retries with backoff.
 * - Malformed messages: logged and discarded.
 * - Send errors per socket: logged and skipped; other sockets are unaffected.
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';
import { ConnectionRegistry } from '../gateway/connection-registry';

// ---------------------------------------------------------------------------
// Item shape published by the API/scheduler
// ---------------------------------------------------------------------------

export interface SlaUpdateItem {
  ticketId: string;
  clockType: 'response' | 'resolution';
  remainingMs: number;
  elapsedPct: number;
  state: string;
  computedAt: string; // ISO-8601
}

export interface SlaPubSubMessage {
  tenantId: string;
  items: SlaUpdateItem[];
}

// ---------------------------------------------------------------------------
// Frame shape sent to WebSocket clients
// ---------------------------------------------------------------------------

export interface SlaDeltaFrame {
  type: 'sla.delta';
  tenantId: string;
  seq: number;
  sentAt: string;
  items: SlaUpdateItem[];
}

// ---------------------------------------------------------------------------
// SlaPubSubSubscriber
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 5_000;

@Injectable()
export class SlaPubSubSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaPubSubSubscriber.name);
  private subscriber: Redis;
  private flushTimer?: ReturnType<typeof setInterval>;
  private ready = false;

  // Buffer: tenantId → Map<`${ticketId}:${clockType}`, SlaUpdateItem>
  private readonly buffer = new Map<string, Map<string, SlaUpdateItem>>();

  // Per-tenant outgoing sequence numbers.
  private readonly seqMap = new Map<string, number>();

  constructor(private readonly registry: ConnectionRegistry) {
    this.subscriber = this.createClient();
  }

  private createClient(): Redis {
    const url = process.env['REDIS_URL'];
    const client = url
      ? new Redis(url, {
          lazyConnect: false,
          enableReadyCheck: true,
          retryStrategy: (times: number) => Math.min(times * 200, 30_000),
        })
      : new Redis({
          lazyConnect: false,
          enableReadyCheck: true,
          retryStrategy: (times: number) => Math.min(times * 200, 30_000),
        });

    client.on('error', (err: Error) => {
      this.logger.error('SLA Redis pub/sub connection error', { message: err.message });
      this.ready = false;
    });
    client.on('ready', () => {
      this.logger.log('SLA Redis pub/sub client ready');
      this.ready = true;
    });
    client.on('reconnecting', () => {
      this.logger.warn('SLA Redis pub/sub reconnecting');
      this.ready = false;
    });

    return client;
  }

  async onModuleInit(): Promise<void> {
    await this.subscriber.psubscribe('sla:*');
    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      this.handleMessage(channel, message);
    });
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    this.logger.log('Subscribed to Redis pattern sla:*');
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.flushTimer);
    await this.subscriber.punsubscribe('sla:*');
    this.subscriber.disconnect();
  }

  isReady(): boolean {
    return this.ready;
  }

  // ---------------------------------------------------------------------------
  // Incoming message handler
  // ---------------------------------------------------------------------------

  private handleMessage(channel: string, message: string): void {
    // channel = "sla:{tenantId}"
    const tenantId = channel.slice('sla:'.length);
    if (!tenantId) return;

    let payload: SlaPubSubMessage;
    try {
      payload = JSON.parse(message) as SlaPubSubMessage;
    } catch {
      this.logger.warn('Unparseable SLA pub/sub message', { channel });
      return;
    }

    const items = payload.items ?? [];
    if (items.length === 0) return;

    let tenantBuf = this.buffer.get(tenantId);
    if (!tenantBuf) {
      tenantBuf = new Map();
      this.buffer.set(tenantId, tenantBuf);
    }

    for (const item of items) {
      const key = `${item.ticketId}:${item.clockType}`;
      const existing = tenantBuf.get(key);
      // Keep the most recent item by computedAt.
      if (!existing || item.computedAt > existing.computedAt) {
        tenantBuf.set(key, item);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5-second flush loop
  // ---------------------------------------------------------------------------

  private flush(): void {
    if (this.buffer.size === 0) return;

    const now = new Date().toISOString();

    for (const [tenantId, itemMap] of this.buffer.entries()) {
      if (itemMap.size === 0) continue;

      const items = Array.from(itemMap.values());
      itemMap.clear();

      const seq = (this.seqMap.get(tenantId) ?? 0) + 1;
      this.seqMap.set(tenantId, seq);

      const frame: SlaDeltaFrame = {
        type: 'sla.delta',
        tenantId,
        seq,
        sentAt: now,
        items,
      };

      this.sendToTenant(tenantId, frame);
    }
  }

  private sendToTenant(tenantId: string, frame: SlaDeltaFrame): void {
    const sockets = this.registry.getTenantSockets(tenantId);
    if (sockets.size === 0) return;

    const serialized = JSON.stringify(frame);

    for (const wrapper of sockets) {
      // Only send to sockets that have subscribed to the dashboard channel.
      if (!wrapper.subscribed) continue;
      if (wrapper.ws.readyState !== 1 /* OPEN */) continue;

      try {
        wrapper.ws.send(serialized);
      } catch (err) {
        this.logger.warn('Failed to send SLA delta frame', {
          tenantId,
          principalId: wrapper.principal.sub,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
