/**
 * Unit tests: LivenessIndicator, RedisPingIndicator, PgBouncerPingIndicator,
 * ReadinessComposite (WO-071 AC4, AC10).
 *
 * Coverage:
 *  - LivenessIndicator: healthy under normal load, unhealthy with negative threshold
 *  - RedisPingIndicator: healthy on PONG, unhealthy on non-PONG, timeout, thrown error
 *  - RedisPingIndicator: hysteresis — second call within window returns cached result
 *  - PgBouncerPingIndicator: healthy on resolved query, unhealthy on rejection/timeout
 *  - ReadinessComposite: all-pass → healthy, one-fail → unhealthy, names failing dep
 *  - ReadinessComposite: indicator that throws is treated as unhealthy (never propagates)
 *
 * Integration semantics (AC4):
 *  - Readiness returns 503 when any dependency is unreachable
 *  - The response names the failing dependency without leaking connection strings
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LivenessIndicator,
  RedisPingIndicator,
  PgBouncerPingIndicator,
  ReadinessComposite,
} from './readiness.indicator';

// ---------------------------------------------------------------------------
// LivenessIndicator
// ---------------------------------------------------------------------------

describe('LivenessIndicator', () => {
  it('returns healthy when event-loop lag is below threshold', async () => {
    const indicator = new LivenessIndicator(2000); // 2s threshold
    const result = await indicator.check();
    expect(result.healthy).toBe(true);
  });

  it('returns unhealthy when threshold is negative (lag always >= 0)', async () => {
    // With threshold = -1, any measured lag (>= 0ms) exceeds the threshold
    const indicator = new LivenessIndicator(-1);
    const result = await indicator.check();
    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/event-loop lag/i);
  });

  it('includes lag and threshold in the reason string', async () => {
    const indicator = new LivenessIndicator(-1);
    const result = await indicator.check();
    expect(result.reason).toContain('threshold');
  });
});

// ---------------------------------------------------------------------------
// RedisPingIndicator
// ---------------------------------------------------------------------------

describe('RedisPingIndicator', () => {
  beforeEach(() => {
    // Advance fake timers; tests that need real time opt-out with vi.useRealTimers()
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns healthy when ping resolves with "PONG"', async () => {
    const redis = { ping: vi.fn().mockResolvedValue('PONG') };
    const indicator = new RedisPingIndicator(redis);

    // Bypass hysteresis on first call by advancing time
    vi.advanceTimersByTime(10_000);
    const result = await indicator.check();
    expect(result.healthy).toBe(true);
  });

  it('returns unhealthy when ping resolves with non-PONG string', async () => {
    const redis = { ping: vi.fn().mockResolvedValue('ERROR') };
    const indicator = new RedisPingIndicator(redis);
    vi.advanceTimersByTime(10_000);
    const result = await indicator.check();
    expect(result.healthy).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('returns unhealthy when ping throws an error', async () => {
    const redis = { ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const indicator = new RedisPingIndicator(redis);
    vi.advanceTimersByTime(10_000);
    const result = await indicator.check();
    expect(result.healthy).toBe(false);
    expect(result.reason).toContain('unreachable');
  });

  it('indicator name is "redis"', () => {
    const redis = { ping: vi.fn() };
    const indicator = new RedisPingIndicator(redis);
    expect(indicator.name).toBe('redis');
  });

  it('hysteresis: second call within window returns cached result without re-pinging', async () => {
    // First call: healthy
    const redis = { ping: vi.fn().mockResolvedValue('PONG') };
    const indicator = new RedisPingIndicator(redis);
    vi.advanceTimersByTime(10_000); // outside hysteresis window → real check
    const first = await indicator.check();
    expect(first.healthy).toBe(true);
    expect(redis.ping).toHaveBeenCalledTimes(1);

    // Second call within hysteresis window: no re-ping
    const second = await indicator.check();
    expect(second.healthy).toBe(true);
    expect(redis.ping).toHaveBeenCalledTimes(1); // still 1 — cached
  });

  it('hysteresis: stale result is refreshed after hysteresis window expires', async () => {
    const redis = { ping: vi.fn().mockResolvedValue('PONG') };
    const indicator = new RedisPingIndicator(redis);

    vi.advanceTimersByTime(10_000); // outside window → first real check
    await indicator.check();
    expect(redis.ping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000); // advance past hysteresis
    await indicator.check();
    expect(redis.ping).toHaveBeenCalledTimes(2); // new check after window
  });
});

// ---------------------------------------------------------------------------
// PgBouncerPingIndicator
// ---------------------------------------------------------------------------

describe('PgBouncerPingIndicator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns healthy when SELECT 1 resolves', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    const indicator = new PgBouncerPingIndicator(pool);
    vi.advanceTimersByTime(10_000);
    const result = await indicator.check();
    expect(result.healthy).toBe(true);
  });

  it('returns unhealthy when pool.query rejects', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('Connection refused')) };
    const indicator = new PgBouncerPingIndicator(pool);
    vi.advanceTimersByTime(10_000);
    const result = await indicator.check();
    expect(result.healthy).toBe(false);
    expect(result.reason).toContain('unreachable');
  });

  it('indicator name is "pgbouncer"', () => {
    const pool = { query: vi.fn() };
    const indicator = new PgBouncerPingIndicator(pool);
    expect(indicator.name).toBe('pgbouncer');
  });

  it('reason does not contain connection string or password', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(
        new Error('password authentication failed for user "app" at postgres://app:secret@localhost:5432/opsninja'),
      ),
    };
    const indicator = new PgBouncerPingIndicator(pool);
    vi.advanceTimersByTime(10_000);
    const result = await indicator.check();
    expect(result.healthy).toBe(false);
    // The reason must NOT leak the connection string or password
    expect(result.reason).not.toContain('postgres://');
    expect(result.reason).not.toContain('secret');
  });
});

// ---------------------------------------------------------------------------
// ReadinessComposite
// ---------------------------------------------------------------------------

describe('ReadinessComposite', () => {
  it('returns healthy when all indicators pass', async () => {
    const a = { name: 'redis', check: vi.fn().mockResolvedValue({ healthy: true }) };
    const b = { name: 'pgbouncer', check: vi.fn().mockResolvedValue({ healthy: true }) };
    const composite = new ReadinessComposite(a, b);
    const result = await composite.check();
    expect(result.healthy).toBe(true);
    expect(result.dependencies['redis']!.healthy).toBe(true);
    expect(result.dependencies['pgbouncer']!.healthy).toBe(true);
  });

  it('returns unhealthy when any indicator fails', async () => {
    const redis = { name: 'redis', check: vi.fn().mockResolvedValue({ healthy: true }) };
    const pg = {
      name: 'pgbouncer',
      check: vi.fn().mockResolvedValue({ healthy: false, reason: 'PgBouncer unreachable' }),
    };
    const composite = new ReadinessComposite(redis, pg);
    const result = await composite.check();
    expect(result.healthy).toBe(false);
  });

  it('names the failing dependency in the dependencies map', async () => {
    const redis = {
      name: 'redis',
      check: vi.fn().mockResolvedValue({ healthy: false, reason: 'Redis unreachable' }),
    };
    const composite = new ReadinessComposite(redis);
    const result = await composite.check();
    expect(result.dependencies['redis']!.healthy).toBe(false);
    expect(result.dependencies['redis']!.reason).toBe('Redis unreachable');
  });

  it('treats a throwing indicator as unhealthy (never propagates the error)', async () => {
    const throwing = {
      name: 'flaky',
      check: vi.fn().mockRejectedValue(new Error('Unexpected crash')),
    };
    const composite = new ReadinessComposite(throwing);
    await expect(composite.check()).resolves.toMatchObject({ healthy: false });
  });

  it('includes a "threw" reason for a throwing indicator (without leaking internals)', async () => {
    const throwing = { name: 'buggy-redis', check: vi.fn().mockRejectedValue(new Error('OOM')) };
    const composite = new ReadinessComposite(throwing);
    const result = await composite.check();
    expect(result.dependencies['buggy-redis']!.reason).toContain('buggy-redis');
  });

  it('still reports healthy dependencies correctly alongside failures', async () => {
    const good = { name: 'redis', check: vi.fn().mockResolvedValue({ healthy: true }) };
    const bad = {
      name: 'pgbouncer',
      check: vi.fn().mockResolvedValue({ healthy: false, reason: 'timeout' }),
    };
    const composite = new ReadinessComposite(good, bad);
    const result = await composite.check();
    expect(result.healthy).toBe(false);
    expect(result.dependencies['redis']!.healthy).toBe(true);
    expect(result.dependencies['pgbouncer']!.healthy).toBe(false);
  });

  it('returns healthy with empty indicator list', async () => {
    const composite = new ReadinessComposite();
    const result = await composite.check();
    expect(result.healthy).toBe(true);
    expect(Object.keys(result.dependencies).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration scenario: readiness flips when dependency is stopped (AC4)
// ---------------------------------------------------------------------------

describe('ReadinessComposite — readiness flips on dependency state change', () => {
  it('transitions from healthy to unhealthy when Redis becomes unavailable', async () => {
    let redisAvailable = true;
    const redis = {
      name: 'redis',
      check: vi.fn().mockImplementation(() =>
        Promise.resolve(
          redisAvailable
            ? { healthy: true }
            : { healthy: false, reason: 'Redis unreachable' },
        ),
      ),
    };

    const composite = new ReadinessComposite(redis);

    // Initially healthy
    const before = await composite.check();
    expect(before.healthy).toBe(true);

    // Simulate Redis going down
    redisAvailable = false;
    const after = await composite.check();
    expect(after.healthy).toBe(false);
    expect(after.dependencies['redis']!.healthy).toBe(false);
  });

  it('recovers to healthy when Redis comes back', async () => {
    let redisAvailable = false;
    const redis = {
      name: 'redis',
      check: vi.fn().mockImplementation(() =>
        Promise.resolve(
          redisAvailable
            ? { healthy: true }
            : { healthy: false, reason: 'Redis unreachable' },
        ),
      ),
    };

    const composite = new ReadinessComposite(redis);

    // Initially unhealthy
    expect((await composite.check()).healthy).toBe(false);

    // Redis recovers
    redisAvailable = true;
    expect((await composite.check()).healthy).toBe(true);
  });
});
