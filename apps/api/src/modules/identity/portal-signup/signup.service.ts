/**
 * SignupService — portal signup state machine entry point.
 *
 * Owns the initiation half of the signup flow:
 *   initiateSignup() — validate email, resolve domain, create/upsert signup
 *                      request, issue verification token, enqueue email.
 *
 * State machine transitions (this service only handles the first transition):
 *   [new] → pending_verification  (initiateSignup)
 *
 * The verification half (pending_verification → verified/pending_approval)
 * is handled by PortalVerificationService which is extended with domain
 * resolution logic. The admin approval half is in PendingApprovalService.
 *
 * Enumeration safety:
 *   The response is identical (202 verification_sent) for:
 *     - A brand-new email address
 *     - An existing account (already verified / already pending)
 *     - A new submission for the same email while a prior token is outstanding
 *   No timing signal beyond crypto-constant noise is returned.
 *
 * Duplicate submissions:
 *   A second signup for the same email while the first is pending_verification
 *   replaces the outstanding token (the unique partial index on email/status
 *   enforces that only one pending request exists; we upsert by email).
 */

import { Injectable, Logger, UnprocessableEntityException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { pool } from '@opsninja/db';

import { validateSignupEmail, EMAIL_VALIDATION_CODES } from './email-validator';
import { DomainResolverService } from './domain-resolver.service';
import { PortalVerificationService } from './portal-verification.service';

export interface InitiateSignupParams {
  email: string;
  applicantName: string;
}

export interface InitiateSignupResult {
  status: 'verification_sent';
}

@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name);

  constructor(
    private readonly domainResolver: DomainResolverService,
    private readonly verificationService: PortalVerificationService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Initiate portal self-service signup.
   *
   * Always returns { status: 'verification_sent' } regardless of whether
   * the email already has an account (enumeration-safe).
   *
   * Throws:
   *   400 SIGNUP_EMAIL_INVALID     — malformed email address
   *   422 SIGNUP_DOMAIN_NOT_ALLOWED — free-mail or disposable domain
   */
  async initiateSignup(params: InitiateSignupParams): Promise<InitiateSignupResult> {
    const { applicantName } = params;

    // Step 1: Validate and normalise email
    const validation = validateSignupEmail(params.email);
    if (!validation.valid) {
      if (validation.code === EMAIL_VALIDATION_CODES.INVALID_FORMAT) {
        throw new BadRequestException({
          error: {
            code: validation.code,
            message: validation.message,
          },
        });
      }
      throw new UnprocessableEntityException({
        error: {
          code: validation.code,
          message: validation.message,
        },
      });
    }

    const { normalised: email, domain } = validation;

    // Step 2: Pre-resolve domain (stores org info early; verification re-checks)
    //   A null result means unmatched — handled at verification time.
    //   Multiple results mean ambiguous — handled at verification time.
    //   We resolve here so we can store the organisation name in the email.
    let preResolvedTenantId: string | null = null;
    let preResolvedOrgId: string | null = null;
    let preResolvedOrgName: string | null = null;

    try {
      const candidates = await this.domainResolver.resolveEmailDomain(domain);
      if (candidates.length === 1) {
        const match = candidates[0]!;
        preResolvedTenantId = match.tenantId;
        preResolvedOrgId = match.organizationId;
        preResolvedOrgName = match.organizationName;
      }
    } catch (err) {
      // Domain resolution failure is non-fatal at signup time — the token
      // will be issued and domain resolution retried at verification time.
      this.logger.warn('Domain resolution failed during signup initiation', { domain });
    }

    // Step 3: Upsert portal_signup_requests
    //   Idempotent: if a pending request already exists for this email, we
    //   update it (which will invalidate the old token in step 4).
    const signupRequestId = await this.upsertSignupRequest(
      email,
      applicantName,
      preResolvedTenantId,
      preResolvedOrgId,
    );

    // Step 4: Issue verification token (invalidates prior outstanding tokens)
    const baseUrl = this.config.get<string>(
      'PORTAL_VERIFY_BASE_URL',
      'https://portal.opsninja.io/verify',
    );

    await this.verificationService.issue(
      signupRequestId,
      email,
      preResolvedTenantId,
      applicantName,
      preResolvedOrgName,
      baseUrl,
    );

    this.logger.log('Portal signup initiated', { domain });

    return { status: 'verification_sent' };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async upsertSignupRequest(
    email: string,
    applicantName: string,
    tenantId: string | null,
    organizationId: string | null,
  ): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.portal_signup_bootstrap', 'true', true)");

      // Check for existing verified/active user — if already active, we still
      // return a new token silently (enumeration safety). The token will be
      // consumed and the redeem path handles the already-active case.
      const existing = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM portal_signup_requests
         WHERE email = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [email],
      );

      if (existing.rows.length > 0 && existing.rows[0]!.status === 'pending_verification') {
        // Update existing pending request (e.g. name correction, org pre-resolution)
        await client.query(
          `UPDATE portal_signup_requests
           SET applicant_name = $2,
               tenant_id = COALESCE($3, tenant_id),
               organization_id = COALESCE($4, organization_id),
               updated_at = now()
           WHERE id = $1`,
          [existing.rows[0]!.id, applicantName, tenantId, organizationId],
        );
        return existing.rows[0]!.id;
      }

      // Create a new signup request row
      const id = randomUUID();
      await client.query(
        `INSERT INTO portal_signup_requests
           (id, tenant_id, organization_id, email, applicant_name, status)
         VALUES ($1, $2, $3, $4, $5, 'pending_verification')
         ON CONFLICT DO NOTHING`,
        [id, tenantId, organizationId, email, applicantName],
      );

      // If ON CONFLICT swallowed the insert, return the existing id
      const row = await client.query<{ id: string }>(
        `SELECT id FROM portal_signup_requests
         WHERE email = $1 AND status = 'pending_verification'
         LIMIT 1`,
        [email],
      );
      return row.rows[0]?.id ?? id;
    } finally {
      client.release();
    }
  }
}
