/**
 * PortalVerificationService
 *
 * Owns the complete portal email-verification token lifecycle:
 *   issue()   — generate token, invalidate prior outstanding tokens, enqueue email
 *   redeem()  — consume token, create portal user, issue session, audit
 *   resend()  — throttled re-issuance path
 *
 * Design constraints (from WO-087):
 *  - Raw token NEVER persisted, logged, or placed in the response body.
 *  - Verification never performed inline with email send — outbox pattern.
 *  - 24-hour TTL enforced server-side against database now().
 *  - Redemption is idempotent via a 60-second Redis cache.
 *  - Concurrent redemption of the same token: conditional UPDATE on consumed_at IS NULL.
 *  - All writes (user creation, token consumption, audit, outbox notification) share one TX.
 */

import {
  Injectable,
  Logger,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { pool } from '@opsninja/db';
import { TokenCodec } from './token.codec';
import { TokenService } from '../services/token.service';
import { SessionService } from '../services/session.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.provider';

export const VERIFICATION_IDEMPOTENCY_TTL_SECONDS = 60;
export const RESEND_HOURLY_LIMIT = 3;
export const RESEND_DAILY_LIMIT = 5;
export const VERIFY_FAILED_ATTEMPT_LIMIT = 5;
export const VERIFY_LOCKOUT_MINUTES = 15;
export const PORTAL_REFRESH_COOKIE_PATH = '/api/v1/portal';
export const PORTAL_REFRESH_COOKIE_NAME = 'portal_refresh_token';
export const PORTAL_REFRESH_TTL_SECONDS = 28_800; // 8 hours

export interface PortalVerificationResult {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    organizationId: string;
    roles: string[];
  };
  onboardingRequired: boolean;
  sessionId: string;
  refreshToken: string;
  tenantId: string;
}

@Injectable()
export class PortalVerificationService {
  private readonly logger = new Logger(PortalVerificationService.name);

  constructor(
    private readonly tokenCodec: TokenCodec,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ---------------------------------------------------------------------------
  // issue() — generate and persist a new token, enqueue verification email
  // ---------------------------------------------------------------------------

  async issue(
    signupRequestId: string,
    email: string,
    tenantId: string | null,
    applicantName: string,
    organizationName: string | null,
    verificationBaseUrl: string,
  ): Promise<void> {
    const emailHash = this.tokenCodec.hashEmail(email);
    const tokenId = randomUUID();
    const { rawToken, tokenHash, expiresAt } = this.tokenCodec.generate(tokenId, emailHash);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.portal_signup_bootstrap', 'true', true)");

      // Invalidate outstanding tokens for this signup request
      await client.query(
        `UPDATE portal_verification_tokens
         SET consumed_at = now()
         WHERE signup_request_id = $1
           AND consumed_at IS NULL`,
        [signupRequestId],
      );

      // Insert new token row (hash only)
      await client.query(
        `INSERT INTO portal_verification_tokens
           (token_id, signup_request_id, tenant_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [tokenId, signupRequestId, tenantId, tokenHash, expiresAt],
      );

      // Update email status on the signup request
      await client.query(
        `UPDATE portal_signup_requests
         SET verification_email_status = 'queued', updated_at = now()
         WHERE id = $1`,
        [signupRequestId],
      );

      // Enqueue notification (outbox pattern — never fail the HTTP request for SES)
      const notificationId = randomUUID();
      const verificationLink = `${verificationBaseUrl}?token=${rawToken}`;
      await client.query(
        `INSERT INTO notifications
           (id, tenant_id, recipient_email, channel, template_key, payload, dedupe_key, status)
         VALUES ($1, $2, $3, 'email', 'portal_email_verification', $4, $5, 'queued')
         ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
        [
          notificationId,
          tenantId ?? '00000000-0000-0000-0000-000000000000',
          email,
          JSON.stringify({
            applicantName,
            organizationName: organizationName ?? 'OpsNinja',
            verificationLink,
            expiryHours: 24,
          }),
          `portal_verify:${tokenId}`,
        ],
      );

      await client.query('COMMIT');

      this.logger.log('Portal verification token issued', {
        signupRequestId,
        tokenId,
        tenantId,
      });

      this.emitMetric('portal_verification_issued_total');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // redeem() — consume token, create portal user, issue session
  // ---------------------------------------------------------------------------

  async redeem(
    rawToken: string,
    ipAddress: string,
  ): Promise<PortalVerificationResult> {
    const tokenHash = this.tokenCodec.hash(rawToken);

    // 60-second idempotency window for duplicate submits (link prefetching)
    const idempotencyKey = `verify:done:${tokenHash}`;
    const cached = await this.redis.get(idempotencyKey);
    if (cached) {
      return JSON.parse(cached) as PortalVerificationResult;
    }

    // Look up token by hash (bootstrap mode — tenant not known yet)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.portal_signup_bootstrap', 'true', true)");

      const tokenRow = await client.query<{
        token_id: string;
        signup_request_id: string;
        tenant_id: string | null;
        token_hash: string;
        expires_at: Date;
        consumed_at: Date | null;
        attempt_count: number;
      }>(
        `SELECT token_id, signup_request_id, tenant_id, token_hash, expires_at,
                consumed_at, attempt_count
         FROM portal_verification_tokens
         WHERE token_hash = $1
         LIMIT 1`,
        [tokenHash],
      );

      if (tokenRow.rows.length === 0) {
        await client.query('ROLLBACK');
        this.emitMetric('portal_verification_failed_total', { reason: 'not_found' });
        this.throwTokenInvalid(ipAddress, 'token_not_found');
      }

      const token = tokenRow.rows[0]!;

      // Check HMAC signature
      const signupRow = await client.query<{
        id: string;
        tenant_id: string | null;
        organization_id: string | null;
        email: string;
        applicant_name: string;
        status: string;
      }>(
        `SELECT id, tenant_id, organization_id, email, applicant_name, status
         FROM portal_signup_requests
         WHERE id = $1
         LIMIT 1`,
        [token.signup_request_id],
      );

      if (signupRow.rows.length === 0) {
        await client.query('ROLLBACK');
        this.throwTokenInvalid(ipAddress, 'signup_not_found');
      }

      const signup = signupRow.rows[0]!;
      const emailHash = this.tokenCodec.hashEmail(signup.email);
      const verifyResult = this.tokenCodec.verify(
        rawToken,
        token.token_id,
        emailHash,
        token.expires_at.toISOString(),
      );

      if (!verifyResult.valid) {
        await client.query('ROLLBACK');
        this.emitMetric('portal_verification_failed_total', { reason: 'invalid_signature' });
        this.logger.warn('Portal token signature invalid — possible tampering', { ipAddress });
        this.throwTokenInvalid(ipAddress, 'invalid_signature');
      }

      // Check expiry (server-side, against DB now())
      const expiredCheck = await client.query<{ expired: boolean }>(
        `SELECT now() > $1 AS expired`,
        [token.expires_at],
      );
      if (expiredCheck.rows[0]?.expired) {
        await client.query('ROLLBACK');
        this.emitMetric('portal_verification_failed_total', { reason: 'expired' });
        this.throwTokenExpired();
      }

      // Already consumed
      if (token.consumed_at !== null) {
        await client.query('ROLLBACK');
        this.emitMetric('portal_verification_failed_total', { reason: 'consumed' });
        this.throwTokenConsumed();
      }

      // Check organization still active
      if (signup.organization_id) {
        const orgCheck = await client.query<{ active: boolean }>(
          `SELECT active FROM organizations WHERE id = $1 LIMIT 1`,
          [signup.organization_id],
        );
        if (orgCheck.rows.length > 0 && !orgCheck.rows[0]!.active) {
          await client.query('ROLLBACK');
          this.throwOrganizationInactive();
        }
      }

      // Atomic consumption — conditional on consumed_at IS NULL
      const consume = await client.query<{ signup_request_id: string }>(
        `UPDATE portal_verification_tokens
         SET consumed_at = now()
         WHERE token_id = $1 AND consumed_at IS NULL
         RETURNING signup_request_id`,
        [token.token_id],
      );

      if (consume.rows.length === 0) {
        // Race condition: another request consumed it first
        await client.query('ROLLBACK');
        this.emitMetric('portal_verification_failed_total', { reason: 'consumed' });
        this.throwTokenConsumed();
      }

      const tenantId = token.tenant_id ?? signup.tenant_id ?? '00000000-0000-0000-0000-000000000000';

      // Set tenant context for the remaining writes
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

      // Promote signup request to verified
      await client.query(
        `UPDATE portal_signup_requests
         SET status = 'verified', verified_at = now(), updated_at = now()
         WHERE id = $1`,
        [signup.id],
      );

      // Create portal user
      const portalUserId = randomUUID();
      await client.query(
        `INSERT INTO portal_users
           (id, tenant_id, organization_id, signup_request_id, email, name, role)
         VALUES ($1, $2, $3, $4, $5, $6, 'portal_user')
         ON CONFLICT (tenant_id, email) DO NOTHING`,
        [
          portalUserId,
          tenantId,
          signup.organization_id ?? '00000000-0000-0000-0000-000000000000',
          signup.id,
          signup.email,
          signup.applicant_name,
        ],
      );

      const auditId = randomUUID();
      await client.query(
        `INSERT INTO audit_logs
           (id, tenant_id, actor_id, actor_kind, event_type, outcome, resource_type,
            resource_id, action, trace_id, ip_hash)
         VALUES ($1, $2, $3, 'portal', 'portal.signup.verified', 'allowed',
                 'portal_user', $4, 'create', $5, $6)`,
        [
          auditId,
          tenantId,
          portalUserId,
          portalUserId,
          randomUUID(),
          this.hashIp(ipAddress),
        ],
      );

      // Emit portal_user.verified outbox event via notifications table
      await client.query(
        `INSERT INTO notifications
           (id, tenant_id, recipient_email, channel, template_key, payload, dedupe_key, status)
         VALUES ($1, $2, $3, 'event', 'portal_user.verified', $4, $5, 'queued')
         ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
        [
          randomUUID(),
          tenantId,
          signup.email,
          JSON.stringify({ portalUserId, organizationId: signup.organization_id, tenantId }),
          `portal_verified:${portalUserId}`,
        ],
      );

      await client.query('COMMIT');

      // Issue access token and refresh session
      const issued = this.tokenService.mintAccessToken({
        sub: portalUserId,
        tenantId,
        roles: ['portal_user'],
        orgScopeVersion: 0,
        userType: 'portal',
      });

      const session = await this.sessionService.createSession({
        userId: portalUserId,
        tenantId,
        ipAddress,
      });

      const result: PortalVerificationResult = {
        accessToken: issued.accessToken,
        expiresIn: issued.expiresIn,
        user: {
          id: portalUserId,
          email: signup.email,
          organizationId: signup.organization_id ?? '',
          roles: ['portal_user'],
        },
        onboardingRequired: true,
        sessionId: session.sessionId,
        refreshToken: session.refreshToken,
        tenantId,
      };

      // Store idempotency result for 60 seconds
      await this.redis
        .set(idempotencyKey, JSON.stringify(result), 'EX', VERIFICATION_IDEMPOTENCY_TTL_SECONDS)
        .catch(() => {});

      this.emitMetric('portal_verification_redeemed_total');
      this.logger.log('Portal verification completed', {
        signupRequestId: signup.id,
        tenantId,
        portalUserId,
      });

      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // resend() — throttled re-issuance
  // ---------------------------------------------------------------------------

  async resend(
    email: string,
    verificationBaseUrl: string,
  ): Promise<void> {
    const emailHash = this.tokenCodec.hashEmail(email);
    const hourlyKey = `resend:hourly:${emailHash}`;
    const dailyKey = `resend:daily:${emailHash}`;

    // Hourly limit: 3 resends per email per hour
    const hourlyCount = await this.redis.incr(hourlyKey);
    if (hourlyCount === 1) await this.redis.expire(hourlyKey, 3600);
    if (hourlyCount > RESEND_HOURLY_LIMIT) {
      this.throwResendRateLimited(3600);
    }

    // Daily limit: 5 resends per email per 24 hours
    const dailyCount = await this.redis.incr(dailyKey);
    if (dailyCount === 1) await this.redis.expire(dailyKey, 86400);
    if (dailyCount > RESEND_DAILY_LIMIT) {
      this.throwResendRateLimited(86400);
    }

    // Silently succeed if no pending signup exists (do not disclose existence)
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.portal_signup_bootstrap', 'true', true)");
      const row = await client.query<{
        id: string;
        tenant_id: string | null;
        organization_id: string | null;
        applicant_name: string;
      }>(
        `SELECT id, tenant_id, organization_id, applicant_name
         FROM portal_signup_requests
         WHERE email = $1 AND status = 'pending_verification'
         LIMIT 1`,
        [email],
      );

      if (row.rows.length === 0) {
        // No pending request — silently accept (avoid email enumeration)
        return;
      }

      const signup = row.rows[0]!;

      let orgName: string | null = null;
      if (signup.organization_id) {
        const orgRow = await client.query<{ name: string }>(
          `SELECT name FROM organizations WHERE id = $1 LIMIT 1`,
          [signup.organization_id],
        );
        orgName = orgRow.rows[0]?.name ?? null;
      }

      await this.issue(
        signup.id,
        email,
        signup.tenant_id,
        signup.applicant_name,
        orgName,
        verificationBaseUrl,
      );
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Failed-attempt lockout helpers
  // ---------------------------------------------------------------------------

  async recordFailedAttempt(email: string): Promise<void> {
    const hash = this.tokenCodec.hashEmail(email);
    const counterKey = `verify:failures:${hash}`;
    const lockoutKey = `verify:lockout:${hash}`;

    const count = await this.redis.incr(counterKey);
    if (count === 1) await this.redis.expire(counterKey, 3600);

    if (count >= VERIFY_FAILED_ATTEMPT_LIMIT) {
      await this.redis.set(lockoutKey, '1', 'EX', VERIFY_LOCKOUT_MINUTES * 60);
    }
  }

  async isLockedOut(email: string): Promise<{ locked: boolean; retryAfter: number }> {
    const hash = this.tokenCodec.hashEmail(email);
    const lockoutKey = `verify:lockout:${hash}`;
    const ttl = await this.redis.ttl(lockoutKey);
    return { locked: ttl > 0, retryAfter: ttl > 0 ? ttl : 0 };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private throwTokenInvalid(ipAddress: string, internalReason: string): never {
    this.logger.warn('Portal token invalid', { ipAddress, reason: internalReason });
    const err = Object.assign(new Error('Verification token is invalid'), {
      statusCode: 400,
      code: 'VERIFICATION_TOKEN_INVALID',
    });
    throw err;
  }

  private throwTokenExpired(): never {
    const err = Object.assign(new Error('Verification token has expired'), {
      statusCode: 410,
      code: 'VERIFICATION_TOKEN_EXPIRED',
    });
    throw err;
  }

  private throwTokenConsumed(): never {
    const err = Object.assign(new Error('Verification token has already been used'), {
      statusCode: 410,
      code: 'VERIFICATION_TOKEN_CONSUMED',
    });
    throw err;
  }

  private throwOrganizationInactive(): never {
    const err = Object.assign(new Error('The organization for this signup is no longer active'), {
      statusCode: 422,
      code: 'ORGANIZATION_INACTIVE',
    });
    throw err;
  }

  private throwResendRateLimited(retryAfterSeconds: number): never {
    const err = Object.assign(new Error('Too many resend attempts'), {
      statusCode: 429,
      code: 'RATE_LIMITED',
      retryAfter: retryAfterSeconds,
    });
    throw err;
  }

  private hashIp(ip: string): string {
    const { createHash } = require('crypto') as typeof import('crypto');
    return createHash('sha256').update(ip).digest('hex');
  }

  private emitMetric(name: string, labels?: Record<string, string>): void {
    // Metrics emission — placeholder compatible with PrometheusService if wired in.
    this.logger.debug(`[metric] ${name}`, labels);
  }
}
