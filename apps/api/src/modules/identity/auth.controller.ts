/**
 * AuthController — refresh and logout endpoints.
 *
 * Both endpoints are decorated with @NoTenantContext because they run before
 * (or during teardown of) a user session — there is no valid access JWT to
 * provide a tenant context.
 *
 * Cookie attributes (per architecture spec):
 *   Name:       refresh_token
 *   httpOnly:   true
 *   Secure:     true
 *   SameSite:   Strict
 *   Path:       /api/v1/auth
 *   Max-Age:    28800 (8 hours)
 *
 * Token values are NEVER placed in response bodies or logs.
 */

import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { NoTenantContext } from '../../common/tenant/no-tenant-context.decorator';
import { Public } from '../../common/auth/public.decorator';
import { TokenService } from './services/token.service';
import { SessionService } from './services/session.service';

export const REFRESH_COOKIE_NAME = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const REFRESH_TTL_SECONDS = 28_800; // 8 hours

@Public()
@NoTenantContext()
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * POST /api/v1/auth/refresh
   *
   * Reads the refresh_token cookie, validates and rotates the session,
   * and returns a fresh access token with a rotated Set-Cookie header.
   *
   * Cookie format: refresh_token={sessionId}.{rawToken}
   *   sessionId — used to look up the Redis record
   *   rawToken  — presented opaque value; its SHA-256 is compared to the stored hash
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieValue = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    const traceId = req.headers['x-trace-id'] as string | undefined;

    if (!cookieValue) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_MISSING',
        message: 'Refresh token cookie is absent',
      });
    }

    const parsed = this.parseCookie(cookieValue);
    if (!parsed) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_INVALID',
        message: 'Malformed refresh token',
      });
    }

    const { sessionId, rawToken } = parsed;

    // Get session metadata needed to mint a new access token.
    const sessionMeta = await this.safeRedis(() =>
      this.sessionService.getSessionRecord(sessionId, this.extractTenantFromCookie(cookieValue)),
    );

    if (!sessionMeta) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_INVALID',
        message: 'Session not found or has been revoked',
      });
    }

    // Check user-level revocation (admin-initiated).
    const userRevoked = await this.safeRedis(() =>
      this.sessionService.isUserRevoked(sessionMeta.userId, sessionMeta.userId),
    );
    if (userRevoked) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_INVALID',
        message: 'User access has been revoked',
      });
    }

    // Perform atomic rotation — throws on reuse/expired/invalid.
    let rotated: { refreshToken: string; familyId: string; sessionId: string };
    try {
      const tenantId = this.extractTenantFromCookie(cookieValue);
      rotated = await this.sessionService.rotateSession({
        sessionId,
        tenantId,
        presentedToken: rawToken,
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'AUTH_SESSION_STORE_UNAVAILABLE') {
        throw new ServiceUnavailableException({
          code,
          message: 'Session store temporarily unavailable',
          retryAfter: 5,
        });
      }
      throw new UnauthorizedException({
        code: code ?? 'AUTH_REFRESH_INVALID',
        message: (err as Error).message,
      });
    }

    // TODO (WO-013): read org_scope_version from Redis counter.
    // Placeholder: 0 until the org-scope version store is implemented.
    const orgScopeVersion = 0;

    // Mint a new access token. We need user claims — in a full implementation
    // these come from the JWT claim cache. For now we use what we have from Redis.
    const issued = this.tokenService.mintAccessToken({
      sub: sessionMeta.userId,
      tenantId: this.extractTenantFromCookie(cookieValue),
      roles: [], // roles come from the cached JWT claims (WO-010)
      orgScopeVersion,
      userType: 'staff',   // default; real kind comes from user record (WO-010)
    });

    // Set the rotated refresh cookie.
    const newCookieValue = this.buildCookieValue(
      rotated.sessionId,
      this.extractTenantFromCookie(cookieValue),
      rotated.refreshToken,
    );
    this.setRefreshCookie(res, newCookieValue, REFRESH_TTL_SECONDS);

    return {
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      orgScopeVersion,
    };
  }

  /**
   * POST /api/v1/auth/logout
   *
   * Revokes the current session server-side and clears the cookie.
   * Returns 204 with an expired Set-Cookie header.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieValue = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

    if (cookieValue) {
      const parsed = this.parseCookie(cookieValue);
      if (parsed) {
        const tenantId = this.extractTenantFromCookie(cookieValue);
        await this.sessionService
          .revokeSession({ sessionId: parsed.sessionId, tenantId, reason: 'logout' })
          .catch((err: Error) => {
            // Non-fatal: log but don't fail the logout — always clear the cookie.
            this.logger.warn('Failed to revoke session on logout', { error: err.message });
          });
      }
    }

    // Always clear the cookie, even if the session was not found.
    this.clearRefreshCookie(res);
  }

  // ---------------------------------------------------------------------------
  // JWKS endpoint (consumed by workers/realtime gateway)
  // ---------------------------------------------------------------------------

  /** GET /api/v1/auth/.well-known/jwks.json */

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Cookie value format: {sessionId}:{tenantId}:{rawToken}
   * The sessionId and tenantId let us look up the Redis key without a scan.
   */
  private buildCookieValue(sessionId: string, tenantId: string, rawToken: string): string {
    return `${sessionId}:${tenantId}:${rawToken}`;
  }

  private parseCookie(
    value: string,
  ): { sessionId: string; tenantId: string; rawToken: string } | null {
    const parts = value.split(':');
    if (parts.length !== 3) return null;
    const [sessionId, tenantId, rawToken] = parts;
    if (!sessionId || !tenantId || !rawToken) return null;
    return { sessionId, tenantId, rawToken };
  }

  private extractTenantFromCookie(value: string): string {
    const parsed = this.parseCookie(value);
    return parsed?.tenantId ?? '';
  }

  private setRefreshCookie(res: Response, value: string, maxAgeSeconds: number): void {
    res.cookie(REFRESH_COOKIE_NAME, value, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: maxAgeSeconds * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.cookie(REFRESH_COOKIE_NAME, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: 0,
    });
  }

  private async safeRedis<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error('Redis operation failed', { error: msg });
      throw new ServiceUnavailableException({
        code: 'AUTH_SESSION_STORE_UNAVAILABLE',
        message: 'Session store temporarily unavailable. Retry after 5 seconds.',
        retryAfter: 5,
      });
    }
  }
}
