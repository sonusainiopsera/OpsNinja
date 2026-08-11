/**
 * CsatTokenGuard
 *
 * Resolves a CSAT survey token (from :token URL param) to a survey row and
 * sets the tenant context for the request.  This is the ONLY place tenant
 * context is derived from a token rather than a JWT session.
 *
 * Flow:
 *  1. Extract :token param from the route URL.
 *  2. Hash with SHA-256 → tokenHash.
 *  3. Enforce Redis rate limits (per token-hash bucket + per IP bucket).
 *  4. Bootstrap lookup: opens a short-lived DB transaction, sets
 *     SET LOCAL app.csat_bootstrap_hash = tokenHash, queries csat_surveys
 *     by token_hash (allowed by the bootstrap branch in the RLS policy),
 *     rolls back the transaction (lookup only), releases the connection.
 *  5. Unknown token → 404.  Expired token → 410.
 *  6. Attaches { rawTokenHash, survey } to request.csatResolved.
 *
 * Security invariants:
 *  - tokenHash is NEVER logged or included in error bodies.
 *  - Rate limit check happens BEFORE any DB lookup (prevents enumeration).
 *  - 404 and 410 have identical response shapes (no existence leak).
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  GoneException,
  Logger,
} from '@nestjs/common';
import { pool } from '@opsninja/db';
import type { Request } from 'express';
import type { CsatResolvedToken, CsatTokenBootstrap } from '@opsninja/db';

import { CsatTokenService } from './csat-token.service';
import { CsatRateLimiter } from './csat-rate-limiter';

@Injectable()
export class CsatTokenGuard implements CanActivate {
  private readonly logger = new Logger(CsatTokenGuard.name);

  constructor(
    private readonly tokenService: CsatTokenService,
    private readonly rateLimiter: CsatRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { csatResolved?: CsatResolvedToken }>();

    const rawToken = req.params['token'];
    if (!rawToken || typeof rawToken !== 'string') {
      throw new NotFoundException({ error: { code: 'CSAT_TOKEN_NOT_FOUND', message: 'Not found' } });
    }

    const tokenHash = this.tokenService.hashToken(rawToken);

    // Rate limiting before any DB lookup — prevents database enumeration.
    const clientIp = this.resolveClientIp(req);
    await this.rateLimiter.checkLimits(tokenHash, clientIp);

    // Bootstrap DB lookup — uses special RLS branch with csat_bootstrap_hash.
    const survey = await this.bootstrapLookup(tokenHash);

    if (!survey) {
      throw new NotFoundException({ error: { code: 'CSAT_TOKEN_NOT_FOUND', message: 'Not found' } });
    }

    if (this.tokenService.isExpired(survey.expiresAt)) {
      throw new GoneException({ error: { code: 'CSAT_TOKEN_EXPIRED', message: 'Survey link has expired' } });
    }

    req.csatResolved = { rawTokenHash: tokenHash, survey };
    return true;
  }

  private async bootstrapLookup(tokenHash: string): Promise<CsatTokenBootstrap | null> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.csat_bootstrap_hash', $1, true)", [tokenHash]);

      const result = await client.query<{
        id: string;
        tenant_id: string;
        ticket_id: string;
        contact_id: string | null;
        expires_at: Date;
        responded_at: Date | null;
        score: number | null;
        delivered: boolean;
      }>(
        `SELECT id, tenant_id, ticket_id, contact_id, expires_at, responded_at, score, delivered
         FROM csat_surveys
         WHERE token_hash = $1
         LIMIT 1`,
        [tokenHash],
      );

      await client.query('ROLLBACK');

      const row = result.rows[0];
      if (!row) return null;

      return {
        id: row.id,
        tenantId: row.tenant_id,
        ticketId: row.ticket_id,
        contactId: row.contact_id,
        expiresAt: new Date(row.expires_at),
        respondedAt: row.responded_at ? new Date(row.responded_at) : null,
        score: row.score,
        delivered: row.delivered,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.logger.error('CSAT bootstrap lookup failed', {
        error: (err as Error).message,
        // tokenHash intentionally excluded from log
      });
      throw err;
    } finally {
      client.release();
    }
  }

  private resolveClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress ?? '0.0.0.0';
  }
}
