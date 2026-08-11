/**
 * RateLimiterService — per-tenant Redis token bucket.
 *
 * Key: notif:rate:{tenant_id}
 * Default capacity: 20 tokens (20 emails/second per tenant).
 * Refill rate: capacity / window_ms (continuous refill).
 *
 * Implementation: Lua script for atomicity — no TOCTOU race between check and consume.
 * A single Redis round-trip per message.
 *
 * Returns true (allowed) or false (bucket empty → SQS visibility timeout requeue).
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export interface RateLimiterConfig {
  capacity: number;
  windowMs: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  capacity: 20,
  windowMs: 1_000,
};

// Lua token bucket — atomic check and consume.
// Returns 1 (allowed) or 0 (rate limited).
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1])
local last_refill = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  last_refill = now
end

local elapsed = now - last_refill
local refill_per_ms = capacity / window_ms
local new_tokens = math.min(capacity, tokens + elapsed * refill_per_ms)

if new_tokens < 1 then
  return 0
end

local ttl_ms = math.ceil(capacity / refill_per_ms)
redis.call('HMSET', key, 'tokens', new_tokens - 1, 'last_refill', now)
redis.call('PEXPIRE', key, ttl_ms)
return 1
`;

@Injectable()
export class RateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly redis: Redis;
  private readonly config: RateLimiterConfig;

  constructor(redisUrl: string, config?: Partial<RateLimiterConfig>) {
    this.redis = new Redis(redisUrl, { lazyConnect: false });
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.redis.on('error', (err: Error) => {
      this.logger.error('Redis error in rate limiter', { message: err.message });
    });
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  /**
   * Attempt to consume one token from the tenant's bucket.
   * Returns true if the send is allowed, false if rate-limited.
   */
  async tryConsume(tenantId: string): Promise<boolean> {
    const key = `notif:rate:${tenantId}`;
    const now = Date.now();

    try {
      const result = await this.redis.eval(
        TOKEN_BUCKET_SCRIPT,
        1,
        key,
        String(this.config.capacity),
        String(this.config.windowMs),
        String(now),
      ) as number;

      return result === 1;
    } catch (err) {
      // Redis outage: allow the send (fail-open for rate limiting only).
      // This avoids stalling delivery when Redis is temporarily unavailable.
      this.logger.warn('Rate limiter Redis error — allowing send', {
        tenantId,
        message: (err as Error).message,
      });
      return true;
    }
  }
}
