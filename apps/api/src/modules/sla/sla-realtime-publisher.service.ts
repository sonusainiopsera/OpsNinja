/**
 * SlaRealtimePublisher — publishes SLA clock updates to Redis pub/sub (WO-050).
 *
 * Called from pause/resume paths and the SLA scheduler after computing updated
 * remaining times. The realtime gateway subscribes to `sla:{tenantId}` and
 * batches messages into 5-second delta frames for connected clients.
 *
 * Publishing is best-effort: if Redis is unavailable the error is logged but
 * never propagated to the caller — the HTTP operation must not fail due to a
 * realtime delivery failure.
 */

import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';
import type { SlaClockType, SlaClockState } from './sla-query.service';

export interface SlaUpdatePayload {
  ticketId: string;
  clockType: SlaClockType;
  remainingMs: number;
  elapsedPct: number;
  state: SlaClockState;
  computedAt: string;
}

@Injectable()
export class SlaRealtimePublisher {
  private readonly logger = new Logger(SlaRealtimePublisher.name);

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  /**
   * Publish one or more SLA clock updates for a tenant.
   * Fire-and-forget — errors are logged but never thrown.
   */
  async publishUpdates(tenantId: string, items: SlaUpdatePayload[]): Promise<void> {
    if (!this.redis || items.length === 0) return;

    const channel = `sla:${tenantId}`;
    const message = JSON.stringify({ tenantId, items });

    try {
      await this.redis.publish(channel, message);
    } catch (err) {
      this.logger.warn('Failed to publish SLA update to Redis', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
