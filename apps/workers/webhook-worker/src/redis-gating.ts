/**
 * Redis-based concurrency and rate-limit gating for webhook delivery.
 *
 * Two controls:
 *  1. Per-endpoint concurrency semaphore: wh:conc:{endpointId}
 *     Default max 5 in-flight deliveries per endpoint.
 *     Implemented as a counter with TTL.
 *
 *  2. Per-tenant token bucket: wh:rate:{tenantId}
 *     Default 20 requests/second.
 *     Implemented as a sliding-window counter.
 *
 * Both use Lua scripts for atomicity.
 */

import Redis from 'ioredis';

const DEFAULT_CONCURRENCY_CAP = parseInt(process.env['WEBHOOK_CONCURRENCY_CAP'] ?? '5', 10);
const DEFAULT_RATE_PER_SECOND = parseInt(process.env['WEBHOOK_RATE_PER_SECOND'] ?? '20', 10);
const CONCURRENCY_TTL_SECONDS = 30; // Stale lock expiry
const RATE_WINDOW_SECONDS = 1;

// Lua: atomic increment if below cap, return new count or -1 if capped
const ACQUIRE_SEMAPHORE_SCRIPT = `
local key = KEYS[1]
local cap = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', key) or '0')
if current >= cap then
  return -1
end
local new = redis.call('INCR', key)
if new == 1 then
  redis.call('EXPIRE', key, ttl)
end
return new
`;

// Lua: atomic decrement (floor at 0)
const RELEASE_SEMAPHORE_SCRIPT = `
local key = KEYS[1]
local current = tonumber(redis.call('GET', key) or '0')
if current > 0 then
  return redis.call('DECR', key)
end
return 0
`;

// Lua: sliding window rate check
const RATE_CHECK_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', key) or '0')
if current >= limit then
  return -1
end
local new = redis.call('INCR', key)
if new == 1 then
  redis.call('EXPIRE', key, window)
end
return new
`;

export class RedisGating {
  constructor(private readonly redis: Redis) {}

  /**
   * Attempt to acquire a concurrency slot for an endpoint.
   * Returns true if acquired (proceed), false if at cap (skip/requeue).
   */
  async acquireConcurrencySlot(endpointId: string): Promise<boolean> {
    const key = `wh:conc:${endpointId}`;
    const result = await this.redis.eval(
      ACQUIRE_SEMAPHORE_SCRIPT,
      1,
      key,
      String(DEFAULT_CONCURRENCY_CAP),
      String(CONCURRENCY_TTL_SECONDS),
    ) as number;
    return result !== -1;
  }

  async releaseConcurrencySlot(endpointId: string): Promise<void> {
    const key = `wh:conc:${endpointId}`;
    await this.redis.eval(RELEASE_SEMAPHORE_SCRIPT, 1, key);
  }

  /**
   * Check per-tenant rate limit.
   * Returns true if allowed (proceed), false if rate limited.
   */
  async checkTenantRateLimit(tenantId: string): Promise<boolean> {
    const key = `wh:rate:${tenantId}`;
    const result = await this.redis.eval(
      RATE_CHECK_SCRIPT,
      1,
      key,
      String(DEFAULT_RATE_PER_SECOND),
      String(RATE_WINDOW_SECONDS),
    ) as number;
    return result !== -1;
  }
}
