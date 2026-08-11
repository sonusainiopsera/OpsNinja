/**
 * ThrottleGuard — NestJS CanActivate guard for auth endpoint rate limiting.
 *
 * Applied to auth endpoints ahead of expensive work (IdP token exchange,
 * email dispatch, database writes). Returns 429 with uniform body and
 * Retry-After header. Fails closed: Redis unavailability yields 503.
 *
 * The 429 body is identical for email-locked and IP-locked to avoid
 * disclosure of which limit fired.
 */

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

import { ThrottleService } from './throttle.service';

const RATE_LIMITED_BODY = (traceId: string) => ({
  error: {
    code: 'AUTH_RATE_LIMITED',
    message: 'Too many attempts. Please try again later.',
    details: [],
    traceId,
  },
});

@Injectable()
export class ThrottleGuard implements CanActivate {
  private readonly logger = new Logger(ThrottleGuard.name);

  constructor(private readonly throttleService: ThrottleService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const ip = this.extractIp(req);
    const email = this.extractEmail(req);

    // Check IP throttle first (cheaper — no email parsing needed).
    const ipResult = await this.throttleService.checkIp(ip);
    if (!ipResult.allowed) {
      res.setHeader('Retry-After', String(ipResult.retryAfterSeconds));
      throw new HttpException(RATE_LIMITED_BODY(traceId), HttpStatus.TOO_MANY_REQUESTS);
    }

    // Check email throttle if an email is present in the request.
    if (email) {
      const emailResult = await this.throttleService.checkEmail(email);
      if (!emailResult.allowed) {
        res.setHeader('Retry-After', String(emailResult.retryAfterSeconds));
        throw new HttpException(RATE_LIMITED_BODY(traceId), HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    return true;
  }

  private extractIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      return (first ?? '').trim();
    }
    return req.socket?.remoteAddress ?? '0.0.0.0';
  }

  private extractEmail(req: Request): string | undefined {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body) return undefined;
    const email = body['email'] ?? body['username'];
    if (typeof email === 'string' && email.length > 0) return email;
    return undefined;
  }
}
