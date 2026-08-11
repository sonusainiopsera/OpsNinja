/**
 * CsatRateLimiter
 *
 * Redis fixed-window rate limiter for public CSAT endpoints.
 *
 * Limits:
 *  - 10 requests per token-hash per hour
 *  - 60 requests per source IP per hour
 *
 * Returns 429 with Retry-After header on breach.
 * Rate check uses INCR+EXPIRE in a pipeline to minimise round trips.
 */

import {
  Injectable,
  Inject,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { createHash } from 'crypto';

import { REDIS_CLIENT } from '../../common/redis/redis.provider';

const TOKEN_LIMIT = 10;
const IP_LIMIT = 60;
const WINDOW_SECONDS = 3600;

@Injectable()
export class CsatRateLimiter {
  private readonly logger = new Logger(CsatRateLimiter.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async checkLimits(tokenHash: string, clientIp: string): Promise<void> {
    const tokenKey = `csat:rl:token:${tokenHash}`;
    // Hash the IP to avoid storing raw IPs in Redis (PII consideration).
    const ipHash = createHash('sha256').update(clientIp).digest('hex').slice(0, 32);
    const ipKey = `csat:rl:ip:${ipHash}`;

    const pipeline = this.redis.pipeline();
    pipeline.incr(tokenKey);
    pipeline.expire(tokenKey, WINDOW_SECONDS, 'NX');
    pipeline.incr(ipKey);
    pipeline.expire(ipKey, WINDOW_SECONDS, 'NX');

    let results: Array<[Error | null, unknown]>;
    try {
      results = (await pipeline.exec()) ?? [];
    } catch (err) {
      // On Redis failure, fail open (do not block legitimate users).
      this.logger.warn('CSAT rate limiter Redis error — failing open', {
        error: (err as Error).message,
      });
      return;
    }

    const tokenCount = typeof results[0]?.[1] === 'number' ? results[0][1] : 0;
    const ipCount = typeof results[2]?.[1] === 'number' ? results[2][1] : 0;

    if (tokenCount > TOKEN_LIMIT || ipCount > IP_LIMIT) {
      throw new HttpException(
        { error: { code: 'CSAT_RATE_LIMITED', message: 'Too many requests' } },
        HttpStatus.TOO_MANY_REQUESTS,
        { headers: { 'Retry-After': String(WINDOW_SECONDS) } },
      );
    }
  }
}
