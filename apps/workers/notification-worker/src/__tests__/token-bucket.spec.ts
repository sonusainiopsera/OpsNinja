/**
 * Unit tests for TokenBucketService rate limiting.
 * Uses a mock Redis client — no infrastructure dependency.
 */

import { TokenBucketService, RateLimitResult } from '../rate-limit/token-bucket.service';

// ── Mock Redis ─────────────────────────────────────────────────────────────────

function makeMockRedis(evalResult: [number, number] | Error = [1, 0]) {
  return {
    eval: jest.fn().mockImplementation(() => {
      if (evalResult instanceof Error) return Promise.reject(evalResult);
      return Promise.resolve(evalResult);
    }),
  };
}

function makeService(redis: ReturnType<typeof makeMockRedis>): TokenBucketService {
  const config = { get: (key: string, def: number) => def } as never;
  return new TokenBucketService(redis as never, config);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TokenBucketService', () => {
  it('returns allowed=true when Redis returns [1, 0]', async () => {
    const redis = makeMockRedis([1, 0]);
    const svc = makeService(redis);
    const result = await svc.consume('tenant-1');
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it('returns allowed=false with retryAfterMs when Redis returns [0, 300]', async () => {
    const redis = makeMockRedis([0, 300]);
    const svc = makeService(redis);
    const result = await svc.consume('tenant-1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(300);
  });

  it('passes the tenant-specific key to Redis', async () => {
    const redis = makeMockRedis([1, 0]);
    const svc = makeService(redis);
    await svc.consume('tenant-abc');
    const call = redis.eval.mock.calls[0];
    expect(call[2]).toBe('notif:rate:tenant-abc');
  });

  it('allows send when Redis throws (fail-open)', async () => {
    const redis = makeMockRedis(new Error('connection refused'));
    const svc = makeService(redis);
    const result = await svc.consume('tenant-1');
    expect(result.allowed).toBe(true);
  });
});
