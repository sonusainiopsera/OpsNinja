import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@opsninja/shared';

/** Timeout for each probe in milliseconds. */
const PROBE_TIMEOUT_MS = 2000;

/**
 * Terminus health indicator for PostgreSQL.
 *
 * Performs a lightweight `SELECT 1` query using the `pg` module.
 * Connection is opened and closed on each probe call (lazy) so that
 * module initialisation never fails even without a database.
 *
 * Override this provider in tests with a stub that throws HealthCheckError
 * to simulate a failing database dependency.
 */
@Injectable()
export class PostgresHealthIndicator extends HealthIndicator {
  constructor(private readonly configService: ConfigService<Env, true>) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const start = Date.now();

    try {
      // Dynamic import avoids hard dependency on `pg` at module load time.
      // The `pg` package must be installed at runtime.
      const { Client } = await import('pg');
      const client = new Client({
        connectionString: this.configService.get('DATABASE_URL', { infer: true }),
        connectionTimeoutMillis: PROBE_TIMEOUT_MS,
        query_timeout: PROBE_TIMEOUT_MS,
      });

      await Promise.race([
        client.connect().then(() => client.query('SELECT 1')).then(() => client.end()),
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
      throw new HealthCheckError('PostgreSQL health check failed', result);
    }
  }
}
