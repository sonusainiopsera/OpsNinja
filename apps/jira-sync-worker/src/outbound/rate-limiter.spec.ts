/**
 * rate-limiter.spec.ts — unit tests for per-tenant Redis token bucket (WO-056 AC9).
 *
 * Uses a fake Redis that intercepts eval() calls to test:
 *   - Token allowed path (Redis returns "1")
 *   - Token exhausted path (Redis returns "0:{ms}")
 *   - Fail-open behavior on Redis error
 *   - Custom capacity/window config forwarded to script
 */

import {
  JiraRateLimiter,
  DEFAULT_RATE_CAPACITY,
  DEFAULT_RATE_WINDOW_MS,
} from './rate-limiter';

// ---------------------------------------------------------------------------
// Fake Redis
// ---------------------------------------------------------------------------

class FakeRedis {
  readonly evalCalls: Array<{ script: string; numkeys: number; args: unknown[] }> = [];
  private _result: string = '1';

  setResult(result: string) {
    this._result = result;
  }

  async eval(script: string, numkeys: number, ...args: unknown[]): Promise<string> {
    this.evalCalls.push({ script, numkeys, args });
    return this._result;
  }
}

function make(redis: FakeRedis): JiraRateLimiter {
  return new JiraRateLimiter(redis as unknown as import('ioredis').default);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('JiraRateLimiter — constants', () => {
  it('DEFAULT_RATE_CAPACITY is 10', () => {
    expect(DEFAULT_RATE_CAPACITY).toBe(10);
  });

  it('DEFAULT_RATE_WINDOW_MS is 1000', () => {
    expect(DEFAULT_RATE_WINDOW_MS).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Allowed path
// ---------------------------------------------------------------------------

describe('JiraRateLimiter — token allowed', () => {
  it('returns allowed=true when Redis returns "1"', async () => {
    const redis = new FakeRedis();
    redis.setResult('1');
    const result = await make(redis).tryConsume('tenant-a');

    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it('passes the correct bucket key to Redis', async () => {
    const redis = new FakeRedis();
    await make(redis).tryConsume('t-abc');

    const call = redis.evalCalls[0]!;
    // args[0] = key, args[1] = capacity, args[2] = windowMs, args[3] = now
    expect(call.args[0]).toBe('jira:ratelimit:t-abc');
    expect(call.numkeys).toBe(1);
  });

  it('passes default capacity and windowMs', async () => {
    const redis = new FakeRedis();
    await make(redis).tryConsume('t-def');

    const call = redis.evalCalls[0]!;
    expect(call.args[1]).toBe(String(DEFAULT_RATE_CAPACITY));
    expect(call.args[2]).toBe(String(DEFAULT_RATE_WINDOW_MS));
  });

  it('passes custom capacity and windowMs', async () => {
    const redis = new FakeRedis();
    await make(redis).tryConsume('t-ghi', { capacity: 20, windowMs: 500 });

    const call = redis.evalCalls[0]!;
    expect(call.args[1]).toBe('20');
    expect(call.args[2]).toBe('500');
  });
});

// ---------------------------------------------------------------------------
// Exhausted path
// ---------------------------------------------------------------------------

describe('JiraRateLimiter — token exhausted', () => {
  it('returns allowed=false with retryAfterMs when Redis returns "0:{ms}"', async () => {
    const redis = new FakeRedis();
    redis.setResult('0:250');
    const result = await make(redis).tryConsume('tenant-b');

    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(250);
  });

  it('returns retryAfterMs=1000 when the wait part is empty', async () => {
    const redis = new FakeRedis();
    redis.setResult('0:');
    const result = await make(redis).tryConsume('tenant-b');

    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(1000);
  });

  it('returns retryAfterMs=1000 when the wait part is NaN', async () => {
    const redis = new FakeRedis();
    redis.setResult('0:abc');
    const result = await make(redis).tryConsume('tenant-b');

    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Fail-open on Redis error
// ---------------------------------------------------------------------------

describe('JiraRateLimiter — fail-open on Redis error', () => {
  it('returns allowed=true when Redis eval throws', async () => {
    const badRedis = {
      eval: jest.fn().mockRejectedValue(new Error('Redis connection refused')),
    };
    const limiter = new JiraRateLimiter(
      badRedis as unknown as import('ioredis').default,
    );

    const result = await limiter.tryConsume('tenant-c');
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it('does not throw on Redis error', async () => {
    const badRedis = {
      eval: jest.fn().mockRejectedValue(new Error('timeout')),
    };
    const limiter = new JiraRateLimiter(
      badRedis as unknown as import('ioredis').default,
    );

    await expect(limiter.tryConsume('tenant-c')).resolves.not.toThrow();
  });
});
