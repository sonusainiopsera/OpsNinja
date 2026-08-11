/**
 * SignupThrottleGuard — per-email and per-IP rate limiting for the portal
 * signup endpoint.
 *
 * Enforced limits (fail-closed on Redis error):
 *   Email:  5 attempts per rolling hour  → lockout key for 15 min on breach
 *   IP:    20 attempts per rolling hour
 *
 * Redis key layout:
 *   ratelimit:signup:email:{sha256(normalised_email)}   — INCR with 3600s TTL
 *   ratelimit:signup:ip:{sha256(ip)}                    — INCR with 3600s TTL
 *   lock:signup:email:{sha256(normalised_email)}        — key exists = locked
 *
 * The guard extracts the email from:
 *   - request.body.email  (POST /signup)
 *   - request.query.email (GET /signup/discovery)
 *
 * Guards that cannot find a valid email fail closed (429).
 */

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.provider';

const EMAIL_HOURLY_LIMIT = 5;
const IP_HOURLY_LIMIT = 20;
const EMAIL_LOCKOUT_SECONDS = 15 * 60; // 15 minutes
const WINDOW_SECONDS = 3600; // 1 hour

@Injectable()
export class SignupThrottleGuard implements CanActivate {
  private readonly logger = new Logger(SignupThrottleGuard.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      body?: { email?: unknown };
      query?: { email?: unknown };
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
      socket?: { remoteAddress?: string };
    }>();

    const rawEmail =
      (typeof req.body?.email === 'string' ? req.body.email : null) ??
      (typeof req.query?.email === 'string' ? req.query.email : null);

    const ip =
      (req.headers?.['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.ip ??
      req.socket?.remoteAddress ??
      'unknown';

    try {
      // IP throttle first (cheaper — no email normalisation needed)
      await this.checkIpThrottle(ip);

      if (rawEmail) {
        await this.checkEmailThrottle(rawEmail.toLowerCase().trim());
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis unavailable — fail closed
      this.logger.error('[signup-throttle] Redis unavailable — failing closed', {
        error: (err as Error).message,
      });
      throw new HttpException(
        { error: { code: 'RATE_LIMITED', message: 'Rate limit store temporarily unavailable.' } },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private hashSubject(subject: string): string {
    return createHash('sha256').update(subject).digest('hex');
  }

  private async checkEmailThrottle(email: string): Promise<void> {
    const hash = this.hashSubject(email);
    const lockKey = `lock:signup:email:${hash}`;
    const rateLimitKey = `ratelimit:signup:email:${hash}`;

    // Check lockout key
    const pttl = await this.redis.pttl(lockKey);
    if (pttl > 0) {
      const retryAfter = Math.ceil(pttl / 1000);
      throw this.buildRateLimitError(retryAfter);
    }

    // Increment and set window TTL on first call
    const pipeline = this.redis.pipeline();
    pipeline.incr(rateLimitKey);
    pipeline.expire(rateLimitKey, WINDOW_SECONDS, 'NX' as never);
    const results = await pipeline.exec();
    const count = (results?.[0]?.[1] as number) ?? 0;

    if (count > EMAIL_HOURLY_LIMIT) {
      // Engage lockout
      await this.redis.set(lockKey, '1', 'EX', EMAIL_LOCKOUT_SECONDS);
      this.logger.warn('[signup-throttle] Email lockout engaged', { emailHash: hash });
      throw this.buildRateLimitError(EMAIL_LOCKOUT_SECONDS);
    }
  }

  private async checkIpThrottle(ip: string): Promise<void> {
    const hash = this.hashSubject(ip);
    const rateLimitKey = `ratelimit:signup:ip:${hash}`;

    const pipeline = this.redis.pipeline();
    pipeline.incr(rateLimitKey);
    pipeline.expire(rateLimitKey, WINDOW_SECONDS, 'NX' as never);
    const results = await pipeline.exec();
    const count = (results?.[0]?.[1] as number) ?? 0;

    if (count > IP_HOURLY_LIMIT) {
      throw this.buildRateLimitError(WINDOW_SECONDS);
    }
  }

  private buildRateLimitError(retryAfterSeconds: number): HttpException {
    return Object.assign(
      new HttpException(
        { error: { code: 'RATE_LIMITED', message: 'Too many signup attempts. Try again later.' } },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      { retryAfterSeconds },
    );
  }
}
