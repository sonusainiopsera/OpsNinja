/**
 * readiness.indicator.ts — Liveness and Readiness health indicator abstractions.
 *
 * Health semantics (AC4):
 *   Liveness  (/healthz): process is responsive (event-loop lag < threshold).
 *             Returns 200 as long as the Node.js event loop is not blocked.
 *   Readiness (/readyz):  process is ready to serve traffic.
 *             Checks every named dependency; returns 503 if any are unhealthy,
 *             naming the failing dependency in the response body for operator
 *             diagnosis without leaking connection strings.
 *
 * Composition:
 *   ReadinessComposite assembles any number of ReadinessIndicator implementations.
 *   RedisPingIndicator — pings Redis via PING command.
 *   PgBouncerPingIndicator — issues SELECT 1 through PgBouncer connection.
 *
 * Failure semantics:
 *   Indicator errors are caught and mapped to unhealthy, never thrown.
 *   The failing dependency name is included in the response without leaking
 *   connection URLs or credentials.
 *
 * Redis flapping hysteresis:
 *   Indicators cache their last result for HYSTERESIS_MS so brief blips
 *   (e.g. Redis restart during rolling upgrade) are absorbed and do not
 *   flip readiness within a single probe interval.
 */

export interface HealthResult {
  healthy: boolean;
  /** Human-readable reason for unhealthy state, safe to include in HTTP response. */
  reason?: string;
}

export interface ReadinessIndicator {
  readonly name: string;
  check(): Promise<HealthResult>;
}

const HYSTERESIS_MS = parseInt(process.env['HEALTH_HYSTERESIS_MS'] ?? '5000', 10);

// ---------------------------------------------------------------------------
// LivenessIndicator — event-loop lag only
// ---------------------------------------------------------------------------

export class LivenessIndicator {
  private readonly lagThresholdMs: number;

  constructor(lagThresholdMs = 2000) {
    this.lagThresholdMs = lagThresholdMs;
  }

  async check(): Promise<HealthResult> {
    const lag = await measureEventLoopLagMs();
    if (lag > this.lagThresholdMs) {
      return { healthy: false, reason: `event-loop lag ${lag}ms exceeds threshold ${this.lagThresholdMs}ms` };
    }
    return { healthy: true };
  }
}

/** Measure event-loop lag using a setImmediate round-trip. */
function measureEventLoopLagMs(): Promise<number> {
  const start = Date.now();
  return new Promise<number>((resolve) => {
    setImmediate(() => resolve(Date.now() - start));
  });
}

// ---------------------------------------------------------------------------
// RedisPingIndicator
// ---------------------------------------------------------------------------

export class RedisPingIndicator implements ReadinessIndicator {
  readonly name = 'redis';
  private lastResult: HealthResult = { healthy: true };
  private lastCheckAt = 0;

  constructor(private readonly redis: { ping(): Promise<string> }) {}

  async check(): Promise<HealthResult> {
    if (Date.now() - this.lastCheckAt < HYSTERESIS_MS) {
      return this.lastResult;
    }
    try {
      const pong = await Promise.race([
        this.redis.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Redis PING timeout')), 2000),
        ),
      ]);
      this.lastResult = pong === 'PONG'
        ? { healthy: true }
        : { healthy: false, reason: 'Redis PING did not return PONG' };
    } catch {
      this.lastResult = { healthy: false, reason: 'Redis unreachable' };
    }
    this.lastCheckAt = Date.now();
    return this.lastResult;
  }
}

// ---------------------------------------------------------------------------
// PgBouncerPingIndicator
// ---------------------------------------------------------------------------

export class PgBouncerPingIndicator implements ReadinessIndicator {
  readonly name = 'pgbouncer';
  private lastResult: HealthResult = { healthy: true };
  private lastCheckAt = 0;

  constructor(private readonly pool: { query(sql: string): Promise<unknown> }) {}

  async check(): Promise<HealthResult> {
    if (Date.now() - this.lastCheckAt < HYSTERESIS_MS) {
      return this.lastResult;
    }
    try {
      await Promise.race([
        this.pool.query('SELECT 1'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('PgBouncer ping timeout')), 3000),
        ),
      ]);
      this.lastResult = { healthy: true };
    } catch {
      this.lastResult = { healthy: false, reason: 'PgBouncer unreachable' };
    }
    this.lastCheckAt = Date.now();
    return this.lastResult;
  }
}

// ---------------------------------------------------------------------------
// ReadinessComposite — aggregates multiple indicators
// ---------------------------------------------------------------------------

export interface ReadinessCheckResult {
  healthy: boolean;
  /** Map of dependency name → health result. */
  dependencies: Record<string, HealthResult>;
}

export class ReadinessComposite {
  private readonly indicators: ReadinessIndicator[];

  constructor(...indicators: ReadinessIndicator[]) {
    this.indicators = indicators;
  }

  async check(): Promise<ReadinessCheckResult> {
    const results = await Promise.all(
      this.indicators.map(async (ind) => {
        try {
          const result = await ind.check();
          return { name: ind.name, result };
        } catch {
          return { name: ind.name, result: { healthy: false, reason: `${ind.name} check threw` } };
        }
      }),
    );

    const dependencies: Record<string, HealthResult> = {};
    let healthy = true;

    for (const { name, result } of results) {
      dependencies[name] = result;
      if (!result.healthy) healthy = false;
    }

    return { healthy, dependencies };
  }
}
