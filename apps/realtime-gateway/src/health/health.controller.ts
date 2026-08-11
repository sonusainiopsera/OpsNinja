import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { PubSubSubscriber } from '../redis/pubsub.subscriber';
import { ConnectionRegistry } from '../gateway/connection-registry';

@Controller()
export class HealthController {
  constructor(
    private readonly pubSub: PubSubSubscriber,
    private readonly registry: ConnectionRegistry,
  ) {}

  /** Liveness: process responsiveness only. */
  @Get('healthz')
  @HttpCode(200)
  healthz(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * Readiness: additionally verifies Redis pub/sub reachability.
   * Returns 503 when Redis is unavailable so the load balancer stops routing.
   */
  @Get('readyz')
  @HttpCode(200)
  readyz(): { status: string; connections: number } {
    if (!this.pubSub.isReady()) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        reason: 'redis_pubsub_not_ready',
      });
    }
    return {
      status: 'ready',
      connections: this.registry.totalConnections(),
    };
  }
}
