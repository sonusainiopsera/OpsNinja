/**
 * PortalVerificationController
 *
 * POST /api/v1/portal/signup/verify  — redeem a verification token
 * POST /api/v1/portal/signup/resend  — resend verification email (throttled)
 *
 * Both routes are @NoTenantContext() (public-facing, pre-authentication).
 * TENANT_ID header is required for multi-tenant routing; single-tenant
 * deployments use the default value from config.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { ConfigService } from '@nestjs/config';
import { NoTenantContext } from '../../../common/tenant/no-tenant-context.decorator';
import { ErrorCode } from '../../../common/errors/app-errors';
import { REFRESH_COOKIE_NAME, REFRESH_TTL_S, SessionService } from '../session.service';
import { PortalVerificationService } from './portal-verification.service';

const COOKIE_PATH = '/api/v1/auth';

const VerifyBodySchema = z.object({
  token: z.string().min(1, 'token is required'),
  tenantId: z.string().uuid('tenantId must be a UUID').optional(),
});

const ResendBodySchema = z.object({
  email: z.string().email('email must be a valid email address'),
  tenantId: z.string().uuid('tenantId must be a UUID').optional(),
});

@NoTenantContext()
@Controller('api/v1/portal/signup')
export class PortalVerificationController {
  private readonly logger = new Logger(PortalVerificationController.name);

  constructor(
    private readonly verificationService: PortalVerificationService,
    private readonly sessionService: SessionService,
    private readonly config: ConfigService,
  ) {}

  /**
   * POST /api/v1/portal/signup/verify
   *
   * Validates the token, creates the portal user, and issues a session.
   * On success: 200 with access token in body + httpOnly refresh cookie.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Body() rawBody: unknown, @Req() _req: Request, @Res() res: Response): Promise<void> {
    const body = this.parseBody(VerifyBodySchema, rawBody);
    const tenantId = body.tenantId ?? this.config.get<string>('DEFAULT_TENANT_ID', 'default');

    const result = await this.verificationService.redeem(body.token, tenantId);

    // Issue refresh session
    const sessionToken = await this.sessionService.createSession({
      userId: result.userId,
      tenantId,
      principalKind: 'portal',
      roles: result.roles,
    });

    const cookieValue = this.sessionService.buildRefreshCookie(sessionToken);
    const isSecure = this.config.get<string>('NODE_ENV') === 'production';

    res.cookie(REFRESH_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: REFRESH_TTL_S * 1000,
    });

    res.status(HttpStatus.OK).json({
      status: 'verified',
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: {
        id: result.userId,
        email: result.email,
        organizationId: result.organizationId,
        roles: result.roles,
      },
      onboardingRequired: result.onboardingRequired,
    });
  }

  /**
   * POST /api/v1/portal/signup/resend
   *
   * Always returns 202 regardless of whether a pending request exists.
   * Throttled: 3 per hour, 5 per 24 hours per email.
   */
  @Post('resend')
  @HttpCode(HttpStatus.ACCEPTED)
  async resend(@Body() rawBody: unknown): Promise<{ status: string }> {
    const body = this.parseBody(ResendBodySchema, rawBody);
    const tenantId = body.tenantId ?? this.config.get<string>('DEFAULT_TENANT_ID', 'default');

    await this.verificationService.resend(body.email, tenantId);

    return { status: 'accepted' };
  }

  private parseBody<T>(schema: z.ZodType<T>, raw: unknown): T {
    try {
      return schema.parse(raw);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new UnprocessableEntityException({
          code: 'SCHEMA_VIOLATION',
          message: 'Request body did not match the expected schema.',
          details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
        });
      }
      throw err;
    }
  }
}
