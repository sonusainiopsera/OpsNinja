/**
 * PortalVerificationController
 *
 * POST /api/v1/portal/signup/verify
 *   Redeem a single-use verification token. On success: returns access token
 *   and sets rotating httpOnly refresh cookie. Tokens in any error state
 *   return distinguishable 4xx codes so the SPA can render actionable guidance.
 *
 * POST /api/v1/portal/signup/resend
 *   Request a fresh verification email. Response is always 202 { status: 'accepted' }
 *   regardless of whether a pending signup exists (avoids email enumeration).
 *   Rate-limited to 3/hr and 5/24h per email; returns 429 with Retry-After.
 *
 * Both routes are @Public() and @NoTenantContext() — they run before any portal
 * user identity is established.
 */

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

import { Public } from '../../../common/auth/public.decorator';
import { NoTenantContext } from '../../../common/tenant/no-tenant-context.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  PortalVerificationService,
  PORTAL_REFRESH_COOKIE_NAME,
  PORTAL_REFRESH_COOKIE_PATH,
  PORTAL_REFRESH_TTL_SECONDS,
} from './portal-verification.service';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

const VerifyTokenSchema = z.object({ token: z.string().min(1).max(512) }).strict();
const ResendSchema = z.object({ email: z.string().email().max(320).toLowerCase() }).strict();

type VerifyTokenDto = z.infer<typeof VerifyTokenSchema>;
type ResendDto = z.infer<typeof ResendSchema>;

// ---------------------------------------------------------------------------
// Error code → HTTP status map
// ---------------------------------------------------------------------------

const ERROR_STATUS_MAP: Record<string, number> = {
  VERIFICATION_TOKEN_INVALID: 400,
  VERIFICATION_TOKEN_EXPIRED: 410,
  VERIFICATION_TOKEN_CONSUMED: 410,
  ORGANIZATION_INACTIVE: 422,
  RATE_LIMITED: 429,
};

@Public()
@NoTenantContext()
@Controller('api/v1/portal/signup')
export class PortalVerificationController {
  private readonly logger = new Logger(PortalVerificationController.name);

  constructor(
    private readonly verificationService: PortalVerificationService,
    private readonly config: ConfigService,
  ) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body(new ZodValidationPipe(VerifyTokenSchema)) dto: VerifyTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = this.extractIp(req);
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    // Check lockout before lookup (avoids DB hits during brute-force)
    // Lockout key requires an email — we cannot check before token lookup.
    // The failed-attempt counter is keyed by email extracted post-lookup.

    let result;
    try {
      result = await this.verificationService.redeem(dto.token, ip);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException & { code?: string }).code;
      const statusCode = code ? (ERROR_STATUS_MAP[code] ?? 500) : 500;

      // Build Retry-After for rate-limited or locked-out responses
      const retryAfter = (err as { retryAfter?: number }).retryAfter;

      if (retryAfter && statusCode === 429) {
        res.setHeader('Retry-After', String(retryAfter));
      }

      throw new HttpException(
        {
          error: {
            code: code ?? 'INTERNAL_ERROR',
            message: (err as Error).message,
            traceId,
          },
        },
        statusCode,
      );
    }

    // Build refresh cookie value: {sessionId}:{tenantId}:{rawToken}
    const cookieValue = `${result.sessionId}:${result.tenantId}:${result.refreshToken}`;
    res.cookie(PORTAL_REFRESH_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: PORTAL_REFRESH_COOKIE_PATH,
      maxAge: PORTAL_REFRESH_TTL_SECONDS * 1000,
    });

    return {
      status: 'verified',
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
      onboardingRequired: result.onboardingRequired,
    };
  }

  @Post('resend')
  @HttpCode(HttpStatus.ACCEPTED)
  async resend(
    @Body(new ZodValidationPipe(ResendSchema)) dto: ResendDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const baseUrl = this.config.get<string>(
      'PORTAL_VERIFY_BASE_URL',
      'https://portal.opsninja.io/verify',
    );

    try {
      await this.verificationService.resend(dto.email, baseUrl);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException & { code?: string }).code;
      if (code === 'RATE_LIMITED') {
        const retryAfter = (err as { retryAfter?: number }).retryAfter ?? 3600;
        res.setHeader('Retry-After', String(retryAfter));
        throw new HttpException(
          {
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many resend attempts. Please try again later.',
              traceId,
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw err;
    }

    // Always return 202 regardless of whether a pending signup exists
    return { status: 'accepted' };
  }

  private extractIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() ?? '0.0.0.0';
    return req.socket?.remoteAddress ?? '0.0.0.0';
  }
}
