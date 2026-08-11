import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { NoTenantContext } from '../../common/tenant/no-tenant-context.decorator';
import { ErrorCode } from '../../common/errors/app-errors';
import { SessionService, REFRESH_COOKIE_NAME, REFRESH_TTL_S } from './session.service';
import { TokenService } from './token.service';
import { AuditWriter } from '../../common/audit/audit-writer';
import { DB_TOKEN } from '../../data/db.module';
import type { DB } from '@opsninja/db';

const COOKIE_PATH = '/api/v1/auth';

/**
 * Auth endpoints for token issuance, rotation and revocation.
 * All routes are exempt from AuthGuard and TenantContextInterceptor because
 * they provide (not consume) authentication.
 */
@NoTenantContext()
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly auditWriter: AuditWriter,
    @Inject(DB_TOKEN) private readonly db: DB,
  ) {}

  /**
   * POST /api/v1/auth/refresh
   *
   * Validates the refresh cookie, rotates the session atomically, and returns a
   * fresh access token plus an updated httpOnly refresh cookie.
   * Returns 401 on missing/invalid/reused tokens, 503 when Redis is unavailable.
   */
  @Post('refresh')
  async refresh(@Req() req: Request, @Res() res: Response): Promise<void> {
    const cookieValue = this.readRefreshCookie(req);

    const parsed = this.sessionService.parseRefreshCookie(cookieValue);
    if (!parsed) {
      throw new UnauthorizedException({
        message: 'Refresh token is malformed.',
        code: ErrorCode.AUTH_REFRESH_INVALID,
      });
    }

    const { tenantId, sessionId, rawToken } = parsed;
    const { newRawToken, orgScopeVersion, principal } = await this.sessionService.rotateSession(
      tenantId,
      sessionId,
      rawToken,
    );

    const minted = this.tokenService.mintAccessToken({
      userId: principal.userId,
      tenantId,
      roles: principal.roles,
      principalKind: principal.principalKind,
      orgScopeVersion,
    });

    const newToken = {
      rawToken: newRawToken,
      sessionId,
      tenantId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_S * 1_000),
    };

    this.setRefreshCookie(res, newToken);

    // Emit auth audit event (outside transaction — auth routes have no tenant tx).
    await this.auditWriter.appendAuthEvent(this.db, {
      action: 'auth.token_refreshed',
      actorType: 'user',
      actorId: principal.userId,
      tenantId,
      outcome: 'success',
      traceId: (req.headers['x-trace-id'] as string | undefined) ?? randomUUID(),
      requestId: (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    });

    res.status(HttpStatus.OK).json({
      accessToken: minted.accessToken,
      expiresIn: minted.expiresIn,
      orgScopeVersion,
    });
  }

  /**
   * POST /api/v1/auth/logout
   *
   * Revokes the current refresh session and clears the cookie.  Returns 204
   * regardless of whether the session exists to avoid oracle attacks.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    const cookieValue = this.readRefreshCookie(req, /* throwing= */ false);

    let logoutTenantId: string | undefined;
    let logoutUserId: string | undefined;

    if (cookieValue) {
      const parsed = this.sessionService.parseRefreshCookie(cookieValue);
      if (parsed) {
        logoutTenantId = parsed.tenantId;
        await this.sessionService
          .revokeSession(parsed.tenantId, parsed.sessionId)
          .catch((err) => this.logger.warn('Revocation error on logout', { err }));
      }
    }

    if (logoutTenantId) {
      await this.auditWriter.appendAuthEvent(this.db, {
        action: 'auth.logout',
        actorType: 'user',
        actorId: logoutUserId ?? null,
        tenantId: logoutTenantId,
        outcome: 'success',
        traceId: (req.headers['x-trace-id'] as string | undefined) ?? randomUUID(),
        requestId: (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
      });
    }

    this.clearRefreshCookie(res);
    res.status(HttpStatus.NO_CONTENT).end();
  }

  // ── Cookie helpers ─────────────────────────────────────────────────────────

  private readRefreshCookie(req: Request, throwing = true): string {
    const cookieValue =
      (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME] ??
      this.parseCookieHeader(req, REFRESH_COOKIE_NAME);

    if (!cookieValue) {
      if (throwing) {
        throw new UnauthorizedException({
          message: 'Refresh token cookie is missing.',
          code: ErrorCode.AUTH_REFRESH_MISSING,
        });
      }
      return '';
    }
    return cookieValue;
  }

  private setRefreshCookie(
    res: Response,
    token: { rawToken: string; sessionId: string; tenantId: string; expiresAt: Date },
  ): void {
    const value = this.sessionService.buildRefreshCookie({
      rawToken: token.rawToken,
      sessionId: token.sessionId,
      tenantId: token.tenantId,
      expiresAt: token.expiresAt,
    });
    res.cookie(REFRESH_COOKIE_NAME, value, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: REFRESH_TTL_S * 1_000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.cookie(REFRESH_COOKIE_NAME, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: 0,
    });
  }

  /** Minimal cookie header parser used when cookie-parser middleware is absent. */
  private parseCookieHeader(req: Request, name: string): string | undefined {
    const header = req.headers['cookie'] ?? '';
    const pairs = header.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const key = pair.slice(0, idx).trim();
      if (key === name) {
        return decodeURIComponent(pair.slice(idx + 1).trim());
      }
    }
    return undefined;
  }
}
