/**
 * TokenBucketService – per-tenant Redis token bucket for outbound email rate limiting.
 *
 * Key: notif:rate:{tenantId}
 * Default rate: 20 tokens/second (configurable via NOTIF_RATE_LIMIT_PER_SECOND).
 *
 * Implemented as a Lua script for atomicity — no TOCTOU race under concurrency.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds to wait before the next token becomes available. */
  retryAfterMs: number;
}

export const NOTIF_REDIS_CLIENT = 'NOTIF_REDIS_CLIENT';

/**
 * Lua token-bucket script.
 * KEYS[1] = bucket key
 * ARGV[1] = max_tokens, ARGV[2] = rate/s, ARGV[3] = now (float epoch seconds), ARGV[4] = cost
 * Returns: [1|0, retry_after_ms]
 */
const TOKEN_BUCKET_LUA = `
local key        = KEYS[1]
local max_tokens = tonumber(ARGV[1])
local rate       = tonumber(ARGV[2])
local now        = tonumber(ARGV[3])
local cost       = tonumber(ARGV[4])

local data       = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens     = tonumber(data[1]) or max_tokens
local last       = tonumber(data[2]) or now

local elapsed    = math.max(0, now - last)
local refilled   = math.min(max_tokens, tokens + elapsed * rate)

if refilled >= cost then
  redis.call('HMSET', key, 'tokens', refilled - cost, 'last_refill', now)
  redis.call('EXPIRE', key, math.ceil(max_tokens / rate) + 10)
  return {1, 0}
else
  local deficit  = cost - refilled
  local wait_ms  = math.ceil((deficit / rate) * 1000)
  redis.call('HMSET', key, 'tokens', refilled, 'last_refill', now)
  redis.call('EXPIRE', key, math.ceil(max_tokens / rate) + 10)
  return {0, wait_ms}
end
`;

@Injectable()
export class TokenBucketService {
  private readonly logger = new Logger(TokenBucketService.name);
  private readonly maxTokens: number;
  private readonly ratePerSecond: number;

  constructor(
    @Inject(NOTIF_REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.maxTokens = config.get<number>('NOTIF_RATE_LIMIT_BURST', 40);
    this.ratePerSecond = config.get<number>('NOTIF_RATE_LIMIT_PER_SECOND', 20);
  }

  async consume(tenantId: string): Promise<RateLimitResult> {
    const key = `notif:rate:${tenantId}`;
    const nowSeconds = Date.now() / 1000;

    try {
      const result = (await this.redis.eval(
        TOKEN_BUCKET_LUA,
        1,
        key,
        String(this.maxTokens),
        String(this.ratePerSecond),
        String(nowSeconds),
        '1',
      )) as [number, number];

      return { allowed: result[0] === 1, retryAfterMs: result[1] ?? 0 };
    } catch (err) {
      // Redis failure: allow send to proceed rather than dropping mail silently.
      this.logger.warn('Token bucket Redis error; allowing send', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { allowed: true, retryAfterMs: 0 };
    }
  }
}
