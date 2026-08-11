/**
 * ThrottleService — sliding-window rate limiting and lockout backed by Redis.
 *
 * Subject keys use SHA-256 of the normalised email/IP so counter storage
 * contains no plaintext PII. Fail-closed on Redis unavailability: callers
 * receive a ServiceUnavailableException rather than being silently allowed.
 *
 * Key layout:
 *   throttle:{sha256(subject)}:failures   INCR key with EX on first set
 *   lockout:{sha256(subject)}             key exists = locked; TTL = lockout window
 */

import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.provider';

export interface ThrottleConfig {
  maxFailuresPerHour: number;
  lockoutMinutes: number;
  perIpWindowSeconds: number;
  perIpLimit: number;
}

const DEFAULTS: ThrottleConfig = {
  maxFailuresPerHour: 5,
  lockoutMinutes: 15,
  perIpWindowSeconds: 3600,
  perIpLimit: 100,
};

export interface ThrottleResult {
  allowed: boolean;
  /** Seconds until the window/lockout expires. 0 when allowed. */
  retryAfterSeconds: number;
}

@Injectable()
export class ThrottleService {
  private readonly logger = new Logger(ThrottleService.name);
  private readonly cfg: ThrottleConfig;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.cfg = {
      maxFailuresPerHour: this.configService.get<number>('THROTTLE_MAX_FAILURES_PER_HOUR', DEFAULTS.maxFailuresPerHour),
      lockoutMinutes: this.configService.get<number>('THROTTLE_LOCKOUT_MINUTES', DEFAULTS.lockoutMinutes),
      perIpWindowSeconds: this.configService.get<number>('THROTTLE_PER_IP_WINDOW_SECONDS', DEFAULTS.perIpWindowSeconds),
      perIpLimit: this.configService.get<number>('THROTTLE_PER_IP_LIMIT', DEFAULTS.perIpLimit),
    };
  }

  /** SHA-256 hex digest of the normalised subject value. */
  private hash(subject: string): string {
    return createHash('sha256').update(subject.toLowerCase().trim()).digest('hex');
  }

  private failureKey(subjectHash: string): string {
    return `throttle:${subjectHash}:failures`;
  }

  private lockoutKey(subjectHash: string): string {
    return `lockout:${subjectHash}`;
  }

  /**
   * Check whether a subject (email or IP) is throttled.
   * Returns retryAfterSeconds > 0 when the request must be rejected.
   * Throws ServiceUnavailableException if Redis is unreachable (fail-closed).
   */
  async checkThrottle(subject: string, windowSeconds: number, maxAttempts: number): Promise<ThrottleResult> {
    const hash = this.hash(subject);
    const lockKey = this.lockoutKey(hash);

    try {
      const pttl = await this.redis.pttl(lockKey);
      if (pttl > 0) {
        const seconds = Math.ceil(pttl / 1000);
        return { allowed: false, retryAfterSeconds: seconds };
      }

      const failKey = this.failureKey(hash);
      const current = await this.redis.get(failKey);
      const count = current ? parseInt(current, 10) : 0;

      if (count >= maxAttempts) {
        // Window not yet expired but lockout key is gone — re-issue lockout.
        const lockoutSeconds = this.cfg.lockoutMinutes * 60;
        await this.redis.set(lockKey, '1', 'EX', lockoutSeconds);
        // Emit degradation metric marker in log
        this.logger.warn('[throttle] Lockout triggered', { subjectHash: hash });
        return { allowed: false, retryAfterSeconds: lockoutSeconds };
      }

      return { allowed: true, retryAfterSeconds: 0 };
    } catch (err) {
      this.logger.error('[throttle] Redis unavailable — failing closed', { error: (err as Error).message });
      throw new ServiceUnavailableException({
        code: 'AUTH_THROTTLE_STORE_UNAVAILABLE',
        message: 'Rate limit store temporarily unavailable. Please try again shortly.',
      });
    }
  }

  /**
   * Record a failed authentication attempt for a subject.
   * Increments the INCR counter and sets lockout when threshold is reached.
   */
  async recordFailure(subject: string): Promise<void> {
    const hash = this.hash(subject);
    const failKey = this.failureKey(hash);
    const lockKey = this.lockoutKey(hash);
    const windowSeconds = 3600; // 1 hour sliding window

    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(failKey);
      // Set window expiry only if key is new (first failure in window).
      pipeline.expire(failKey, windowSeconds, 'NX');
      const results = await pipeline.exec();

      // results[0][1] is the new count after INCR
      const newCount = (results?.[0]?.[1] as number) ?? 0;

      if (newCount >= this.cfg.maxFailuresPerHour) {
        const lockoutSeconds = this.cfg.lockoutMinutes * 60;
        await this.redis.set(lockKey, '1', 'EX', lockoutSeconds);
        this.logger.warn('[throttle] Lockout issued after failure threshold', {
          subjectHash: hash,
          count: newCount,
          lockoutSeconds,
        });
      }
    } catch (err) {
      // Log but do not throw — the auth denial already happened; counter
      // failure is non-fatal to the security outcome (request is still denied).
      this.logger.error('[throttle] Failed to record failure counter', { error: (err as Error).message });
    }
  }

  /**
   * Clear the failure counter and lockout for a subject after successful auth.
   */
  async recordSuccess(subject: string): Promise<void> {
    const hash = this.hash(subject);
    const pipeline = this.redis.pipeline();
    pipeline.del(this.failureKey(hash));
    pipeline.del(this.lockoutKey(hash));
    try {
      await pipeline.exec();
    } catch (err) {
      this.logger.error('[throttle] Failed to clear success counters', { error: (err as Error).message });
    }
  }

  /**
   * Unlock a subject by its raw email (admin-initiated).
   */
  async adminUnlock(email: string): Promise<void> {
    const hash = this.hash(email);
    const pipeline = this.redis.pipeline();
    pipeline.del(this.failureKey(hash));
    pipeline.del(this.lockoutKey(hash));
    try {
      await pipeline.exec();
    } catch (err) {
      this.logger.error('[throttle] Failed to clear lockout on admin unlock', { error: (err as Error).message });
      throw new ServiceUnavailableException({
        code: 'AUTH_THROTTLE_STORE_UNAVAILABLE',
        message: 'Rate limit store temporarily unavailable.',
      });
    }
  }

  /**
   * Check email throttle. Returns ThrottleResult; fails closed on Redis error.
   */
  async checkEmail(email: string): Promise<ThrottleResult> {
    return this.checkThrottle(email, 3600, this.cfg.maxFailuresPerHour);
  }

  /**
   * Check IP throttle. Returns ThrottleResult; fails closed on Redis error.
   */
  async checkIp(ip: string): Promise<ThrottleResult> {
    return this.checkThrottle(ip, this.cfg.perIpWindowSeconds, this.cfg.perIpLimit);
  }

  /** Returns the ThrottleConfig (for test introspection). */
  getConfig(): ThrottleConfig {
    return { ...this.cfg };
  }
}
