/**
 * PubSubSubscriber – singleton Redis pub/sub consumer.
 *
 * Maintains ONE dedicated Redis client subscribed to pattern dash:*
 * (pub/sub clients cannot be shared with command clients).
 *
 * On each message, dispatches to ConnectionRegistry for the matching tenant.
 * Reconnects with exponential backoff (capped at 30s) on client disconnect,
 * and exposes isReady() for /readyz to gate readiness.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ConnectionRegistry } from '../gateway/connection-registry';
import { filterFrameForSocket, isTenantWideRole, type DashboardFrame } from '../gateway/org-scope-filter';
import { redactLogRecord } from '@opsninja/observability';

const DASH_PATTERN = 'dash:*';
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 30_000;

@Injectable()
export class PubSubSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PubSubSubscriber.name);
  private client: Redis;
  private ready = false;
  private destroyed = false;
  private backoffAttempts = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ConnectionRegistry,
  ) {
    this.client = this.createClient();
  }

  onModuleInit(): void {
    void this.subscribe();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    this.client.disconnect();
  }

  isReady(): boolean {
    return this.ready;
  }

  private createClient(): Redis {
    return new Redis(this.config.get<string>('REDIS_URL', 'redis://localhost:6379'), {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }

  private async subscribe(): Promise<void> {
    try {
      await this.client.connect();

      this.client.on('message', (channel: string, message: string) => {
        this.onMessage(channel, message);
      });

      this.client.on('pmessage', (_pattern: string, channel: string, message: string) => {
        this.onMessage(channel, message);
      });

      this.client.on('error', (err: Error) => {
        this.logger.error(redactLogRecord({ event: 'pubsub.error', error: err.message }));
        this.ready = false;
      });

      this.client.on('close', () => {
        this.ready = false;
        if (!this.destroyed) {
          void this.reconnectWithBackoff();
        }
      });

      await this.client.psubscribe(DASH_PATTERN);
      this.ready = true;
      this.backoffAttempts = 0;
      this.logger.log({ event: 'pubsub.subscribed', pattern: DASH_PATTERN });
    } catch (err) {
      this.ready = false;
      this.logger.error({
        event: 'pubsub.subscribe_failed',
        error: err instanceof Error ? err.message : String(err),
      });
      if (!this.destroyed) {
        void this.reconnectWithBackoff();
      }
    }
  }

  private async reconnectWithBackoff(): Promise<void> {
    if (this.destroyed) return;

    const delay = Math.min(
      BACKOFF_BASE_MS * Math.pow(2, this.backoffAttempts++),
      BACKOFF_CAP_MS,
    );

    this.logger.warn({ event: 'pubsub.reconnecting', delayMs: delay, attempt: this.backoffAttempts });
    await sleep(delay);

    if (this.destroyed) return;

    this.client = this.createClient();
    void this.subscribe();
  }

  private onMessage(channel: string, message: string): void {
    // channel format: dash:{tenantId}
    const tenantId = channel.replace(/^dash:/, '');
    if (!tenantId) return;

    let frame: DashboardFrame;
    try {
      frame = JSON.parse(message) as DashboardFrame;
    } catch {
      this.logger.warn({ event: 'pubsub.malformed_message', channel });
      return;
    }

    const sockets = this.registry.getByTenant(tenantId);
    if (sockets.length === 0) return;

    for (const wrapper of sockets) {
      if (wrapper.socket.readyState !== 1 /* WebSocket.OPEN */) continue;

      const tenantWide = isTenantWideRole(wrapper.principal.roles);
      const filtered = filterFrameForSocket(frame, wrapper.principal.orgScopeIds, tenantWide);

      try {
        wrapper.socket.send(JSON.stringify(filtered));
        wrapper.lastDeliveredSeq = frame.seq ?? wrapper.lastDeliveredSeq;
      } catch (err) {
        this.logger.warn({
          event: 'pubsub.send_failed',
          socketId: wrapper.id,
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
