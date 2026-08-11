/**
 * SignupController — POST /api/v1/portal/signup
 *
 * Entry point for portal self-service signup. Accepts a business email address
 * and triggers the verification flow.
 *
 * Enumeration safety:
 *   The endpoint always returns 202 { status: 'verification_sent' } regardless
 *   of whether the email already has an account, is in an existing pending state,
 *   or produces a domain match. Error codes are only returned for invalid input.
 *
 * @Public() + @NoTenantContext(): no authentication or tenant transaction needed
 *   at the submission step — the user has not yet proven ownership of the email.
 */

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  HttpException,
  Logger,
} from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../../../common/auth/public.decorator';
import { NoTenantContext } from '../../../common/tenant/no-tenant-context.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { SignupService } from './signup.service';

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

const SignupRequestSchema = z
  .object({
    /** The applicant's business email address. */
    email: z.string().trim().min(3).max(320),
    /**
     * The applicant's display name (required for the verification email and
     * onboarding flow).
     */
    applicantName: z.string().trim().min(1).max(200),
  })
  .strict();

type SignupRequestDto = z.infer<typeof SignupRequestSchema>;

// ---------------------------------------------------------------------------
// Error-code → HTTP status map
// ---------------------------------------------------------------------------

const ERROR_STATUS_MAP: Record<string, number> = {
  SIGNUP_EMAIL_INVALID: HttpStatus.BAD_REQUEST,
  SIGNUP_DOMAIN_NOT_ALLOWED: HttpStatus.UNPROCESSABLE_ENTITY,
};

@Public()
@NoTenantContext()
@Controller('api/v1/portal/signup')
export class SignupController {
  private readonly logger = new Logger(SignupController.name);

  constructor(private readonly signupService: SignupService) {}

  /**
   * POST /api/v1/portal/signup
   *
   * Request: { email: string, applicantName: string }
   * Response 202: { status: 'verification_sent' }
   *
   * Errors:
   *   400 SIGNUP_EMAIL_INVALID     — malformed email format
   *   422 SIGNUP_DOMAIN_NOT_ALLOWED — free-mail / disposable domain
   *
   * All other inputs (including existing accounts) return 202.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(
    @Body(new ZodValidationPipe(SignupRequestSchema)) dto: SignupRequestDto,
  ) {
    try {
      return await this.signupService.initiateSignup({
        email: dto.email,
        applicantName: dto.applicantName,
      });
    } catch (err: unknown) {
      // Re-throw NestJS HTTP exceptions directly (from service validation)
      if (err instanceof HttpException) throw err;

      const code = (err as { error?: { code?: string }; code?: string })?.error?.code
        ?? (err as { code?: string })?.code;
      const status = code ? (ERROR_STATUS_MAP[code] ?? HttpStatus.INTERNAL_SERVER_ERROR) : HttpStatus.INTERNAL_SERVER_ERROR;

      throw new HttpException(
        {
          error: {
            code: code ?? 'INTERNAL_ERROR',
            message: (err as Error).message ?? 'An unexpected error occurred.',
          },
        },
        status,
      );
    }
  }
}
