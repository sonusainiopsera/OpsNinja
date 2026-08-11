/**
 * ThrottleService – application-level rate limiting for authentication endpoints.
 *
 * Sliding-window counters via Redis INCR + TTL (approximate, single round-trip).
 * Separate lockout keys hold the exact Retry-After TTL.
 *
 * Redis key scheme (all values are SHA-256 hashes of normalised subjects — no PII stored):
 *   throttle:count:{hash}           — INCR counter; TTL = windowSeconds
 *   throttle:locked:{hash}          — lockout marker; TTL = lockoutSeconds
 *
 * Fail-closed on Redis unavailability: returns 503-equivalent to prevent
 * unlimited attempts when the rate-limit store is unreachable.
 */

import { Inject, Injectable, Logger, ServiceUnavailableException, TooManyRequestsException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { ErrorCode } from '../errors/app-errors';

export interface ThrottleCheckResult {
  allowed: boolean;
  /** Seconds until the lockout expires. 0 when not locked. */
  retryAfterSeconds: number;
}

export type ThrottleSubjectType = 'email' | 'ip' | 'tenant';

@Injectable()
export class ThrottleService {
  private readonly logger = new Logger(ThrottleService.name);

  /** Maximum failed attempts in the window before lockout. */
  private readonly maxFailures: number;
  /** Window duration in seconds. Default: 3600 (1 hour). */
  private readonly windowSeconds: number;
  /** Lockout duration in seconds. Default: 900 (15 min). */
  private readonly lockoutSeconds: number;
  /** Per-IP max requests in its window. */
  private readonly perIpLimit: number;
  /** Per-IP window in seconds. */
  private readonly perIpWindow: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.maxFailures    = config.get<number>('THROTTLE_MAX_FAILURES', 5);
    this.windowSeconds  = config.get<number>('THROTTLE_WINDOW_SECONDS', 3600);
    this.lockoutSeconds = config.get<number>('THROTTLE_LOCKOUT_SECONDS', 900);
    this.perIpLimit     = config.get<number>('THROTTLE_PER_IP_LIMIT', 100);
    this.perIpWindow    = config.get<number>('THROTTLE_PER_IP_WINDOW_SECONDS', 3600);
  }

  /**
   * Checks whether a subject is currently throttled or locked out.
   * Records a new failure attempt if `recordFailure` is true.
   *
   * Throws TooManyRequestsException (429) with Retry-After set if locked.
   * Throws ServiceUnavailableException (503) when Redis is unavailable.
   */
  async checkAndRecord(
    subjectType: ThrottleSubjectType,
    subject: string,
    recordFailure: boolean,
  ): Promise<void> {
    const hash = this.hashSubject(subjectType, subject);
    const lockKey  = `throttle:locked:${hash}`;
    const countKey = `throttle:count:${hash}`;

    try {
      // ── 1. Check existing lockout ───────────────────────────────────────
      const lockTtl = await this.redis.ttl(lockKey);
      if (lockTtl > 0) {
        throw new TooManyRequestsException({
          code: ErrorCode.AUTH_RATE_LIMITED,
          message: 'Too many attempts. Please try again later.',
          details: [],
        });
      }

      if (!recordFailure) return;

      // ── 2. Increment failure counter ────────────────────────────────────
      const pipeline = this.redis.pipeline();
      pipeline.incr(countKey);
      pipeline.ttl(countKey);
      const results = await pipeline.exec();

      if (!results) {
        this.handleRedisUnavailable('pipeline returned null');
      }

      const count = (results![0][1] as number) ?? 0;
      const existingTtl = (results![1][1] as number) ?? -1;

      // Set TTL on first increment
      if (existingTtl < 0) {
        await this.redis.expire(countKey, this.windowSeconds);
      }

      // ── 3. Trigger lockout if threshold exceeded ─────────────────────────
      if (count >= this.maxFailures) {
        await this.redis.set(lockKey, '1', 'EX', this.lockoutSeconds);
        // Clear the counter so it doesn't linger after lockout expires
        await this.redis.del(countKey);

        this.logger.warn({
          event: 'auth.throttle.lockout_triggered',
          subjectType,
          subjectHash: hash.slice(0, 8),
          count,
        });

        throw new TooManyRequestsException({
          code: ErrorCode.AUTH_RATE_LIMITED,
          message: 'Too many attempts. Please try again later.',
          details: [],
        });
      }
    } catch (err) {
      if (err instanceof TooManyRequestsException || err instanceof ServiceUnavailableException) {
        throw err;
      }
      this.handleRedisUnavailable((err as Error).message);
    }
  }

  /**
   * Resets the failure counter for a subject on successful authentication.
   * No-op if Redis is unavailable.
   */
  async resetCounters(subjectType: ThrottleSubjectType, subject: string): Promise<void> {
    const hash = this.hashSubject(subjectType, subject);
    try {
      await this.redis.pipeline()
        .del(`throttle:count:${hash}`)
        .del(`throttle:locked:${hash}`)
        .exec();
    } catch (err) {
      this.logger.warn('Failed to reset throttle counters', {
        subjectType,
        subjectHash: hash.slice(0, 8),
        error: (err as Error).message,
      });
    }
  }

  /**
   * Removes the lockout key for a subject (admin unlock operation).
   * Returns the remaining TTL that was cleared (0 if not locked).
   */
  async adminUnlock(subjectType: ThrottleSubjectType, subject: string): Promise<number> {
    const hash = this.hashSubject(subjectType, subject);
    const lockKey = `throttle:locked:${hash}`;
    try {
      const ttl = await this.redis.ttl(lockKey);
      if (ttl > 0) {
        await this.redis.pipeline()
          .del(lockKey)
          .del(`throttle:count:${hash}`)
          .exec();
        this.logger.log({
          event: 'auth.throttle.admin_unlock',
          subjectType,
          subjectHash: hash.slice(0, 8),
          clearedTtl: ttl,
        });
        return ttl;
      }
      return 0;
    } catch (err) {
      this.logger.warn('Admin unlock Redis error', { error: (err as Error).message });
      return 0;
    }
  }

  /**
   * Returns the remaining lockout TTL for a subject (for Retry-After).
   * Returns 0 when not locked or Redis unavailable.
   */
  async getLockoutTtl(subjectType: ThrottleSubjectType, subject: string): Promise<number> {
    const hash = this.hashSubject(subjectType, subject);
    try {
      const ttl = await this.redis.ttl(`throttle:locked:${hash}`);
      return ttl > 0 ? ttl : 0;
    } catch {
      return 0;
    }
  }

  /** SHA-256 of normalised `type:subject` — no PII stored in Redis. */
  hashSubject(subjectType: ThrottleSubjectType, subject: string): string {
    const normalised = `${subjectType}:${subject.toLowerCase().trim()}`;
    return createHash('sha256').update(normalised).digest('hex');
  }

  private handleRedisUnavailable(detail: string): never {
    this.logger.error('OPERATOR_ALERT: ThrottleService Redis unavailable — failing closed', { detail });
    throw new ServiceUnavailableException({
      code: 'AUTH_STORE_UNAVAILABLE',
      message: 'Authentication service temporarily unavailable.',
    });
  }
}
