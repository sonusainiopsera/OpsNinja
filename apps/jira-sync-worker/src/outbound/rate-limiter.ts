/**
 * rate-limiter.ts — per-tenant Redis token bucket for outbound Jira calls.
 *
 * Key per tenant: jira:ratelimit:{tenantId}
 * Default capacity: 10 tokens (10 requests/second per tenant).
 * Configurable per connection via rateLimit.capacity and rateLimit.windowMs.
 *
 * Uses an atomic Lua script to prevent TOCTOU races across multiple worker
 * replicas — a plain read-modify-write would allow burst overdrafts when two
 * pods process events for the same tenant simultaneously.
 *
 * Returns { allowed, retryAfterMs } — the caller extends the SQS visibility
 * timeout by retryAfterMs on rate-limited messages rather than blocking.
 */

import { Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_RATE_CAPACITY = 10;   // tokens
export const DEFAULT_RATE_WINDOW_MS = 1_000; // 1 second

// ---------------------------------------------------------------------------
// Lua token bucket
// ---------------------------------------------------------------------------

/**
 * Atomic token-bucket script.
 * KEYS[1] = bucket key
 * ARGV[1] = capacity (integer)
 * ARGV[2] = window_ms (milliseconds)
 * ARGV[3] = now (milliseconds since epoch)
 *
 * Returns: "1" (allowed) or "0:{retry_after_ms}" (rate-limited).
 */
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
  -- Return ms until we have one token
  local wait_ms = math.ceil((1 - new_tokens) / refill_per_ms)
  return '0:' .. wait_ms
end

-- Consume one token
local ttl_ms = math.ceil(capacity / refill_per_ms) + window_ms
redis.call('HMSET', key, 'tokens', new_tokens - 1, 'last_refill', now)
redis.call('PEXPIRE', key, ttl_ms)
return '1'
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  /** True when a token was consumed and the call may proceed. */
  allowed: boolean;
  /** Milliseconds to wait before retrying (only when allowed=false). */
  retryAfterMs: number;
}

export interface RateLimitConfig {
  capacity: number;
  windowMs: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class JiraRateLimiter {
  private readonly logger = new Logger(JiraRateLimiter.name);

  constructor(private readonly redis: Redis) {}

  /**
   * Attempt to consume one token from the tenant's rate bucket.
   *
   * Fail-open: if Redis is unavailable the call is allowed so a Redis outage
   * does not block all outbound Jira writes.
   */
  async tryConsume(
    tenantId: string,
    config: RateLimitConfig = { capacity: DEFAULT_RATE_CAPACITY, windowMs: DEFAULT_RATE_WINDOW_MS },
  ): Promise<RateLimitResult> {
    const key = `jira:ratelimit:${tenantId}`;
    const now = Date.now();

    try {
      const result = await this.redis.eval(
        TOKEN_BUCKET_SCRIPT,
        1,
        key,
        String(config.capacity),
        String(config.windowMs),
        String(now),
      ) as string;

      if (result === '1') {
        return { allowed: true, retryAfterMs: 0 };
      }

      // result is '0:{wait_ms}'
      const retryAfterMs = parseInt(result.split(':')[1] ?? '1000', 10);
      return { allowed: false, retryAfterMs };
    } catch (err: unknown) {
      // Fail-open: Redis unavailable → allow the call
      this.logger.warn('JiraRateLimiter Redis error — allowing call (fail-open)', {
        tenantId,
        error: (err as Error).message,
      });
      return { allowed: true, retryAfterMs: 0 };
    }
  }
}
