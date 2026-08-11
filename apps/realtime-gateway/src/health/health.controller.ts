/**
 * Health endpoints — /healthz (liveness) and /readyz (readiness).
 *
 * Liveness (/healthz): process is responsive. Always 200 while the process is up.
 * Readiness (/readyz): process is ready to serve traffic. Verifies Redis pub/sub
 *   connectivity; returns 503 when the Redis connection is degraded.
 *
 * These endpoints are NOT behind any auth guard (@Public equivalent —
 * they must be reachable by Kubernetes probes without credentials).
 */

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PubSubSubscriber } from '../redis/pubsub.subscriber';
import { DashboardGateway } from '../gateway/dashboard.gateway';

@Controller()
export class HealthController {
  constructor(
    private readonly pubsub: PubSubSubscriber,
    private readonly gateway: DashboardGateway,
  ) {}

  /**
   * GET /healthz — liveness probe.
   * Returns 200 as long as the process is alive and responsive.
   */
  @Get('healthz')
  @HttpCode(HttpStatus.OK)
  healthz(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * GET /readyz — readiness probe.
   * Returns 200 when Redis pub/sub is connected and ready.
   * Returns 503 when the pub/sub connection is degraded.
   */
  @Get('readyz')
  @HttpCode(HttpStatus.OK)
  readyz(): { status: string; connections: number } {
    if (!this.pubsub.isReady()) {
      throw new ServiceUnavailableException('Redis pub/sub not ready');
    }
    return {
      status: 'ok',
      connections: this.gateway.connectionCount(),
    };
  }
}
