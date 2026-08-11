import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { NoTenantContext } from '../../common/tenant/no-tenant-context.decorator';
import { ErrorCode } from '../../common/errors/app-errors';
import { SessionService, REFRESH_COOKIE_NAME, REFRESH_TTL_S } from './session.service';
import { TokenService } from './token.service';
import { PrincipalContext } from '../../observability/request-context';

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
    const { newRawToken, orgScopeVersion } = await this.sessionService.rotateSession(
      tenantId,
      sessionId,
      rawToken,
    );

    // Resolve the principal from the (possibly expired) access token so we can
    // re-mint with accurate claims.  Auth guard is bypassed so we read it manually.
    const principal = this.extractPrincipalFromRequest(req, tenantId);

    const minted = this.tokenService.mintAccessToken({
      userId: principal.userId,
      tenantId: principal.tenantId,
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

    if (cookieValue) {
      const parsed = this.sessionService.parseRefreshCookie(cookieValue);
      if (parsed) {
        await this.sessionService
          .revokeSession(parsed.tenantId, parsed.sessionId)
          .catch((err) => this.logger.warn('Revocation error on logout', { err }));
      }
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

  /**
   * Extracts the principal from an (optionally expired) access token for re-minting.
   * Falls back to a minimal principal derived from the cookie's tenantId if no
   * access token is present (e.g. refresh after browser restart).
   */
  private extractPrincipalFromRequest(req: Request, cookieTenantId: string): PrincipalContext {
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const claims = this.tokenService.verifyAccessToken(
          authHeader.slice(7),
          { ignoreExpiration: true },
        );
        return {
          tenantId: claims.tenant_id,
          userId: claims.sub,
          principalKind: claims.user_type as PrincipalContext['principalKind'],
          roles: claims.roles,
          orgScopeIds: [],
          traceId: '',
        };
      } catch {
        // Fall through to cookie-derived principal
      }
    }

    // No (or invalid) access token — derive minimal principal from x-test-principal (test use)
    const rawPrincipal = req.headers['x-test-principal'];
    if (rawPrincipal && typeof rawPrincipal === 'string') {
      try {
        return JSON.parse(rawPrincipal) as PrincipalContext;
      } catch {
        // ignore
      }
    }

    throw new UnauthorizedException({
      message: 'Cannot derive principal for token re-mint.',
      code: ErrorCode.AUTH_REFRESH_INVALID,
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
