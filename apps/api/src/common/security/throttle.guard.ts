/**
 * ThrottleGuard – NestJS execution guard that enforces per-email and per-IP
 * rate limits on authentication endpoints.
 *
 * Applied at the controller or route level via @UseGuards(ThrottleGuard).
 * Routes opt into throttling by decorating with @ThrottleByEmail() and/or
 * @ThrottleByIp().  If neither decorator is present the guard passes through.
 *
 * Guard execution order: ThrottleGuard runs BEFORE any expensive downstream
 * work (token exchange, email send, DB writes) — throttled requests are cheap.
 *
 * The guard only CHECKS for lockouts (and increments counters for failures)
 * at the ingress stage.  The owning controller calls throttleService.resetCounters()
 * on success and throttleService.checkAndRecord(..., true) to record each
 * failure.  This two-phase approach lets the controller decide what constitutes
 * a "failure" (e.g. wrong password vs. Redis outage).
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  TooManyRequestsException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ThrottleService } from './throttle.service';
import { ErrorCode } from '../errors/app-errors';

export const THROTTLE_EMAIL_KEY = 'throttle:email';
export const THROTTLE_IP_KEY    = 'throttle:ip';

/** Apply email-hash throttling to an auth route. */
export const ThrottleByEmail = () => SetMetadata(THROTTLE_EMAIL_KEY, true);
/** Apply IP-hash throttling to an auth route. */
export const ThrottleByIp    = () => SetMetadata(THROTTLE_IP_KEY, true);

@Injectable()
export class ThrottleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly throttleService: ThrottleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const handler = context.getHandler();
    const cls     = context.getClass();
    const req     = context.switchToHttp().getRequest<Request & { headers: Record<string, string | string[] | undefined> }>();
    const res     = context.switchToHttp().getResponse<Response>();

    const checkEmail = this.reflector.getAllAndOverride<boolean>(THROTTLE_EMAIL_KEY, [handler, cls]);
    const checkIp    = this.reflector.getAllAndOverride<boolean>(THROTTLE_IP_KEY, [handler, cls]);

    if (!checkEmail && !checkIp) return true;

    try {
      if (checkIp) {
        const ip = this.extractIp(req);
        await this.throttleService.checkAndRecord('ip', ip, false);
      }

      if (checkEmail) {
        const email = this.extractEmail(req);
        if (email) {
          await this.throttleService.checkAndRecord('email', email, false);
        }
      }
    } catch (err) {
      if (err instanceof TooManyRequestsException) {
        // Compute Retry-After from actual lockout TTL
        const retryAfter = await this.computeRetryAfter(req, checkEmail, checkIp);
        res.set('Retry-After', String(retryAfter));
        throw new TooManyRequestsException({
          code: ErrorCode.AUTH_RATE_LIMITED,
          message: 'Too many attempts. Please try again later.',
          details: [],
        });
      }
      throw err;
    }

    return true;
  }

  private extractIp(req: Request): string {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string') {
      return forwardedFor.split(',')[0].trim();
    }
    return (req.socket?.remoteAddress ?? req.ip ?? '0.0.0.0');
  }

  private extractEmail(req: Request): string | undefined {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body) return undefined;
    const email = body['email'] ?? body['username'];
    return typeof email === 'string' ? email : undefined;
  }

  private async computeRetryAfter(
    req: Request,
    checkEmail: boolean,
    checkIp: boolean,
  ): Promise<number> {
    // Default 15 min if we can't look it up
    let ttl = 900;
    try {
      if (checkEmail) {
        const email = this.extractEmail(req);
        if (email) {
          const emailTtl = await this.throttleService.getLockoutTtl('email', email);
          if (emailTtl > 0) ttl = emailTtl;
        }
      }
      if (checkIp) {
        const ip = this.extractIp(req);
        const ipTtl = await this.throttleService.getLockoutTtl('ip', ip);
        if (ipTtl > 0 && ipTtl < ttl) ttl = ipTtl;
      }
    } catch {
      // Return default
    }
    return ttl;
  }
}
