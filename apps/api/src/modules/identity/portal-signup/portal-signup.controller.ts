/**
 * PortalSignupController — unauthenticated portal self-service signup.
 *
 * Routes:
 *   POST /api/v1/portal/signup           — submit a signup request
 *   GET  /api/v1/portal/signup/discovery — query authMode for an email
 *
 * Both routes are:
 *   @Public()         — no JWT required
 *   @NoTenantContext() — no tenant transaction opened
 *   @UseGuards(SignupThrottleGuard) — per-email + per-IP Redis rate limiting
 *
 * Response design (non-disclosing):
 *   - All accepted paths return HTTP 202 with identical shape.
 *   - email_verification and pending_approval are byte-identical (same keys).
 *   - Only sso adds ssoRedirectUrl; blocklist adds 422; throttle adds 429.
 *   - Stack traces NEVER appear in error responses.
 *
 * The Retry-After header is set on 429 responses when the guard provides
 * a retryAfterSeconds value.
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Res,
  HttpException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';

import { Public } from '../../../common/auth/public.decorator';
import { NoTenantContext } from '../../../common/tenant/no-tenant-context.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { SignupThrottleGuard } from '../guards/signup-throttle.guard';
import { PortalSignupService } from './portal-signup.service';
import {
  CreateSignupSchema,
  type CreateSignupDto,
  DiscoveryQuerySchema,
  type DiscoveryQueryDto,
} from './dto/create-signup.dto';

@Public()
@NoTenantContext()
@UseGuards(SignupThrottleGuard)
@Controller('api/v1/portal/signup')
export class PortalSignupController {
  private readonly logger = new Logger(PortalSignupController.name);

  constructor(private readonly signupService: PortalSignupService) {}

  // ---------------------------------------------------------------------------
  // POST /api/v1/portal/signup
  // ---------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(
    @Body(new ZodValidationPipe(CreateSignupSchema)) dto: CreateSignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const sourceIp = this.extractIp(req);
    const userAgent = (req.headers['user-agent'] ?? '').substring(0, 512);

    try {
      const result = await this.signupService.handleSignup({
        email: dto.email,
        fullName: dto.fullName,
        sourceIp,
        userAgent,
        traceId,
      });
      return result;
    } catch (err: unknown) {
      this.handleError(err, res, traceId);
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/portal/signup/discovery?email=
  // ---------------------------------------------------------------------------

  @Get('discovery')
  @HttpCode(HttpStatus.OK)
  async discovery(
    @Query(new ZodValidationPipe(DiscoveryQuerySchema)) query: DiscoveryQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    try {
      const result = await this.signupService.handleDiscovery({
        email: query.email,
        traceId,
      });
      return result;
    } catch (err: unknown) {
      this.handleError(err, res, traceId);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private extractIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
    return req.ip ?? 'unknown';
  }

  /**
   * Centralised error handler.
   *
   * Re-throws NestJS HttpExceptions directly (they already have the right shape).
   * Converts unknown errors to 503 SIGNUP_TEMPORARILY_UNAVAILABLE.
   * Sets Retry-After header on 429 responses.
   */
  private handleError(err: unknown, res: Response, traceId: string): never {
    if (err instanceof HttpException) {
      const status = err.getStatus();
      // Set Retry-After on throttle errors when retryAfterSeconds is attached
      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        const retryAfter = (err as HttpException & { retryAfterSeconds?: number }).retryAfterSeconds;
        if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
      }
      throw err;
    }

    this.logger.error('[signup] Unexpected error', {
      traceId,
      error: (err as Error).message,
    });
    throw new InternalServerErrorException({
      error: {
        code: 'SIGNUP_TEMPORARILY_UNAVAILABLE',
        message: 'Signup temporarily unavailable. Please try again shortly.',
        traceId,
      },
    });
  }
}
