import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@opsninja/shared';

/** Timeout for each probe in milliseconds. */
const PROBE_TIMEOUT_MS = 2000;

/**
 * Terminus health indicator for Redis.
 *
 * Issues a PING command using the `ioredis` module.
 * Connection is opened and closed on each probe call (lazy) so that
 * module initialisation never fails even without a Redis instance.
 *
 * Override this provider in tests with a stub to simulate failures.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly configService: ConfigService<Env, true>) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const start = Date.now();

    try {
      const { default: Redis } = await import('ioredis');
      const client = new Redis(this.configService.get('REDIS_URL', { infer: true }), {
        connectTimeout: PROBE_TIMEOUT_MS,
        commandTimeout: PROBE_TIMEOUT_MS,
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
      });

      await Promise.race([
        client.connect().then(() => client.ping()).then(() => client.quit()),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS),
        ),
      ]);

      return this.getStatus(key, true, { latency_ms: Date.now() - start });
    } catch (err) {
      const result = this.getStatus(key, false, {
        latency_ms: Date.now() - start,
        error: err instanceof Error ? err.message : 'unknown error',
      });
      throw new HealthCheckError('Redis health check failed', result);
    }
  }
}
