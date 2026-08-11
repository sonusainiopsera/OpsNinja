/**
 * CsatTokenGuard – resolves a URL-path CSAT token to a survey row and
 * attaches it to the request without requiring a session JWT.
 *
 * This is the only place in the codebase where tenant context derives from
 * a capability token rather than a JWT session.  The guard resolves the survey
 * row (which carries tenant_id) and attaches it to request[CSAT_SURVEY_KEY].
 * Downstream services open their own tenant-bound transactions keyed on that
 * tenant_id — they do not rely on a globally set session variable.
 *
 * Outcomes:
 *   - Unknown token hash → 404 (no information about the ticket)
 *   - Token found but expired → 410 Gone
 *   - Token found, not expired → attaches survey to request, proceeds
 *
 * Rate limiting fires BEFORE the DB lookup to avoid per-token DB queries
 * under probe attacks.
 */

import {
  CanActivate,
  ExecutionContext,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  TooManyRequestsException,
} from '@nestjs/common';
import type { Request } from 'express';
import Redis from 'ioredis';
import { eq, sql } from 'drizzle-orm';
import { csatSurveys, type CsatSurvey, type DB } from '@opsninja/db';
import { CsatTokenService } from './csat-token.service';
import { ErrorCode } from '../../common/errors/app-errors';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';
import { DB_TOKEN } from '../../data/db.module';

export const CSAT_SURVEY_KEY = 'csat:survey';

/** Fixed-window limits (per hour). */
const TOKEN_WINDOW_SEC = 3600;
const TOKEN_MAX = 10;
const IP_WINDOW_SEC = 3600;
const IP_MAX = 60;

@Injectable()
export class CsatTokenGuard implements CanActivate {
  private readonly logger = new Logger(CsatTokenGuard.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly tokenService: CsatTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request & { [CSAT_SURVEY_KEY]?: CsatSurvey }>();

    const rawToken = req.params?.['token'] as string | undefined;
    if (!rawToken) {
      throw new NotFoundException({
        code: ErrorCode.CSAT_TOKEN_UNKNOWN,
        message: 'Survey not found.',
      });
    }

    const tokenHash = this.tokenService.hashToken(rawToken);

    // ── Rate limiting: per-token-hash (before DB lookup) ─────────────────────
    const tokenKey = `csat:rl:tok:${tokenHash}`;
    const tokenCount = await this.incrementFixedWindow(tokenKey, TOKEN_WINDOW_SEC);
    if (tokenCount > TOKEN_MAX) {
      throw new TooManyRequestsException({
        code: ErrorCode.CSAT_RATE_LIMITED,
        message: 'Too many requests. Please try again later.',
      });
    }

    // ── Rate limiting: per client IP ─────────────────────────────────────────
    const clientIp = this.extractClientIp(req);
    if (clientIp) {
      const ipKey = `csat:rl:ip:${clientIp}`;
      const ipCount = await this.incrementFixedWindow(ipKey, IP_WINDOW_SEC);
      if (ipCount > IP_MAX) {
        throw new TooManyRequestsException({
          code: ErrorCode.CSAT_RATE_LIMITED,
          message: 'Too many requests. Please try again later.',
        });
      }
    }

    // ── Database lookup (by globally-unique token_hash index) ────────────────
    // token_hash has a cross-tenant UNIQUE index but csat_surveys has FORCE RLS.
    // Without an active tenant context the RLS policy would block the lookup.
    // We disable row security for this single transaction so the guard can
    // resolve the tenant_id from the token, then downstream queries run with
    // full tenant-scoped RLS re-enabled.
    // The API DB user must have BYPASSRLS or be a superuser for this to succeed.
    const rows = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL row_security = off`);
      return tx.select().from(csatSurveys).where(eq(csatSurveys.tokenHash, tokenHash)).limit(1);
    });

    if (rows.length === 0) {
      this.logger.debug('CSAT token not found');
      throw new NotFoundException({
        code: ErrorCode.CSAT_TOKEN_UNKNOWN,
        message: 'Survey not found.',
      });
    }

    const survey = rows[0];

    // Constant-time verification (defence-in-depth)
    if (!this.tokenService.verifyHash(tokenHash, survey.tokenHash)) {
      throw new NotFoundException({
        code: ErrorCode.CSAT_TOKEN_UNKNOWN,
        message: 'Survey not found.',
      });
    }

    // ── Expiry check ─────────────────────────────────────────────────────────
    if (this.tokenService.isExpired(survey.expiresAt)) {
      throw new GoneException({
        code: ErrorCode.CSAT_TOKEN_EXPIRED,
        message: 'This survey link has expired.',
      });
    }

    req[CSAT_SURVEY_KEY] = survey;
    return true;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async incrementFixedWindow(key: string, windowSec: number): Promise<number> {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, windowSec);
      }
      return count;
    } catch {
      // Redis unavailable: allow through rather than blocking all CSAT traffic
      return 0;
    }
  }

  private extractClientIp(req: Request): string | undefined {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      return first?.trim();
    }
    return req.socket?.remoteAddress;
  }
}
