/**
 * Redis pub/sub subscriber — singleton per pod.
 *
 * Subscribes once to the pattern `dash:*` using a dedicated Redis connection
 * (pub/sub clients cannot be shared with command clients in ioredis).
 *
 * On each message, dispatches to the matching tenant's socket set via
 * ConnectionRegistry, applying org-scope filtering before serialisation.
 *
 * Error handling:
 * - Redis connection loss: marks readiness false, retries with ioredis
 *   automatic reconnect + exponential backoff (capped at 30s).
 * - Re-subscription after reconnect: ioredis re-subscribes automatically
 *   after reconnection for pattern subscriptions.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConnectionRegistry } from '../gateway/connection-registry';
import { applyOrgScopeFilter } from '../gateway/org-scope-filter';
import type { DeltaFrame, RedisPublishPayload } from '../gateway/frame.types';

@Injectable()
export class PubSubSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PubSubSubscriber.name);
  private subscriber: Redis;
  private ready = false;

  constructor(private readonly registry: ConnectionRegistry) {
    this.subscriber = this.createClient();
  }

  private createClient(): Redis {
    const url = process.env['REDIS_URL'];
    const client = url
      ? new Redis(url, {
          lazyConnect: false,
          enableReadyCheck: true,
          retryStrategy: (times: number) =>
            Math.min(times * 200, 30_000),
        })
      : new Redis({
          lazyConnect: false,
          enableReadyCheck: true,
          retryStrategy: (times: number) =>
            Math.min(times * 200, 30_000),
        });

    client.on('error', (err: Error) => {
      this.logger.error('Redis pub/sub connection error', { message: err.message });
      this.ready = false;
    });

    client.on('ready', () => {
      this.logger.log('Redis pub/sub client ready');
      this.ready = true;
    });

    client.on('reconnecting', () => {
      this.logger.warn('Redis pub/sub reconnecting');
      this.ready = false;
    });

    return client;
  }

  async onModuleInit(): Promise<void> {
    // Subscribe to all tenant dashboard channels.
    await this.subscriber.psubscribe('dash:*');

    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      this.handleMessage(channel, message);
    });

    this.logger.log('Subscribed to Redis pattern dash:*');
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber.punsubscribe('dash:*');
    this.subscriber.disconnect();
  }

  /** Whether the Redis pub/sub connection is healthy. */
  isReady(): boolean {
    return this.ready;
  }

  private handleMessage(channel: string, message: string): void {
    // channel is "dash:{tenantId}"
    const tenantId = channel.slice('dash:'.length);
    if (!tenantId) return;

    let payload: RedisPublishPayload;
    try {
      payload = JSON.parse(message) as RedisPublishPayload;
    } catch {
      this.logger.warn('Received unparseable pub/sub message', { channel });
      return;
    }

    const sockets = this.registry.getTenantSockets(tenantId);
    if (sockets.size === 0) return;

    const nowStr = new Date().toISOString();

    for (const wrapper of sockets) {
      if (!wrapper.subscribed) continue;
      if (wrapper.ws.readyState !== 1 /* WebSocket.OPEN */) continue;

      try {
        const filteredPayload = applyOrgScopeFilter(
          { globalCounters: payload.globalCounters, orgBreakdown: payload.orgBreakdown },
          wrapper.principal.orgScopeIds,
        );

        const frame: DeltaFrame = {
          type: 'delta',
          tenantId,
          seq: payload.seq,
          sentAt: nowStr,
          payload: filteredPayload,
        };

        wrapper.ws.send(JSON.stringify(frame));
        wrapper.lastDeliveredSeq = payload.seq;
      } catch (err) {
        this.logger.warn('Failed to send delta frame to socket', {
          tenantId,
          principalId: wrapper.principal.sub,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
