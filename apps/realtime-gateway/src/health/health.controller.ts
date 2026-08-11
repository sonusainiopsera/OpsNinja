/**
 * Health endpoints — /healthz (liveness) and /readyz (readiness).
 *
 * Liveness (/healthz): process is responsive. Returns 200 while event-loop
 *   lag is under the configured threshold (default 2000ms). Based solely on
 *   process responsiveness — no external dependency checked (AC4).
 *
 * Readiness (/readyz): process is ready to serve traffic. Verifies Redis
 *   pub/sub connectivity via RedisPingIndicator. Returns 503 with the name
 *   of the failing dependency when any check fails.
 *   Dependencies are reported by name only — no connection strings or
 *   credentials are ever included in the response body.
 *
 * Health semantics (WO-071 AC4):
 *   - Liveness checks event-loop lag only.
 *   - Readiness additionally verifies external dependencies.
 *   - A pod failing readiness is removed from rotation so it does not
 *     black-hole connections while its dependency is broken.
 *
 * Redis flapping hysteresis:
 *   RedisPingIndicator caches its last result for HEALTH_HYSTERESIS_MS
 *   (default 5s) so brief blips are absorbed and do not flip readiness
 *   within a single probe interval.
 *
 * These endpoints are NOT behind any auth guard — they must be reachable
 * by Kubernetes probes without credentials.
 */

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  LivenessIndicator,
  ReadinessComposite,
  RedisPingIndicator,
} from '@opsninja/observability';
import { PubSubSubscriber } from '../redis/pubsub.subscriber';
import { DashboardGateway } from '../gateway/dashboard.gateway';

@Controller()
export class HealthController {
  private readonly liveness: LivenessIndicator;
  private readonly readiness: ReadinessComposite;

  constructor(
    private readonly pubsub: PubSubSubscriber,
    private readonly gateway: DashboardGateway,
  ) {
    this.liveness = new LivenessIndicator();

    // Gateway never queries Postgres directly, so only Redis is checked.
    this.readiness = new ReadinessComposite(
      new RedisPingIndicator({
        ping: () => pubsub.ping(),
      }),
    );
  }

  /**
   * GET /healthz — liveness probe.
   * Returns 200 as long as the event loop is responsive.
   * Returns 503 if event-loop lag exceeds threshold.
   */
  @Get('healthz')
  @HttpCode(HttpStatus.OK)
  async healthz(): Promise<{ status: string }> {
    const result = await this.liveness.check();
    if (!result.healthy) {
      throw new ServiceUnavailableException(result.reason ?? 'Event loop unresponsive');
    }
    return { status: 'ok' };
  }

  /**
   * GET /readyz — readiness probe.
   * Returns 200 when all dependencies are healthy.
   * Returns 503 with dependency name(s) when any check fails.
   */
  @Get('readyz')
  @HttpCode(HttpStatus.OK)
  async readyz(): Promise<{ status: string; connections: number; dependencies: Record<string, unknown> }> {
    const result = await this.readiness.check();

    if (!result.healthy) {
      const unhealthy = Object.entries(result.dependencies)
        .filter(([, r]) => !r.healthy)
        .map(([name, r]) => `${name}: ${r.reason ?? 'unhealthy'}`);
      throw new ServiceUnavailableException(`Dependencies unhealthy: ${unhealthy.join('; ')}`);
    }

    return {
      status:       'ok',
      connections:  this.gateway.connectionCount(),
      dependencies: result.dependencies,
    };
  }
}
