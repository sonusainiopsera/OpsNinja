/**
 * PortalVerificationService
 *
 * Owns the full verification token lifecycle:
 *   issue()  – generate token, invalidate any outstanding tokens, enqueue email
 *   redeem() – verify token, create portal user, issue session, emit outbox event
 *   resend() – throttle check, invalidate old tokens, re-issue
 *
 * Rules:
 * - Raw tokens are NEVER persisted or logged.
 * - Email is dispatched via the notifications outbox (never inline).
 * - User creation, token consumption, audit and outbox are one atomic transaction.
 * - 60-second Redis idempotency window on successful redemption.
 */

import {
  GoneException,
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  TooManyRequestsException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { eq, and, isNull, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import {
  portalVerificationTokens,
  portalSignupRequests,
  portalUsers,
  auditLogs,
  notifications,
} from '@opsninja/db';
import type { DB } from '@opsninja/db';
import { DB_TOKEN } from '../../../data/db.module';
import { REDIS_CLIENT } from '../../../common/redis/redis.provider';
import { ErrorCode } from '../../../common/errors/app-errors';
import { TokenService } from '../token.service';
import { SessionService } from '../session.service';
import { createHash } from 'crypto';
import {
  generateToken,
  verifyToken,
  hashEmail,
  TOKEN_TTL_HOURS,
} from './token.codec';

// ── Constants ─────────────────────────────────────────────────────────────────

const IDEMPOTENCY_TTL_S = 60;
const RESEND_HOURLY_LIMIT = 3;
const RESEND_HOURLY_WINDOW_S = 3600;
const RESEND_DAILY_LIMIT = 5;
const RESEND_DAILY_WINDOW_S = 86400;
const FAILED_ATTEMPT_LIMIT = 5;
const FAILED_ATTEMPT_WINDOW_S = 3600;
const LOCKOUT_TTL_S = 900; // 15 minutes
const VERIFICATION_TEMPLATE_KEY = 'portal.signup.verify';
const PORTAL_USER_ROLE = 'portal_user';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IssueResult {
  tokenId: string;
  expiresAt: Date;
}

export interface RedeemResult {
  accessToken: string;
  expiresIn: number;
  userId: string;
  email: string;
  organizationId: string | null;
  roles: string[];
  onboardingRequired: boolean;
}

export interface ResendResult {
  status: 'accepted';
}

@Injectable()
export class PortalVerificationService {
  private readonly logger = new Logger(PortalVerificationService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Issues a new verification token for the given signup request.
   * Invalidates all outstanding tokens for the same signup_request_id first.
   * Enqueues a verification email via the notifications outbox.
   */
  async issue(params: {
    signupRequestId: string;
    tenantId: string;
    email: string;
    applicantName: string | null;
    organizationId: string | null;
    organizationName?: string | null;
  }): Promise<IssueResult> {
    const { signupRequestId, tenantId, email, applicantName, organizationId, organizationName } = params;
    const hmacKey = this.config.get<string>('VERIFICATION_HMAC_KEY', 'default-dev-key');
    const { rawToken, tokenHash, expiresAt } = generateToken(hmacKey);
    const tokenId = randomUUID();
    const portalBaseUrl = this.config.get<string>('PORTAL_BASE_URL', 'https://portal.opsninja.io');
    const verifyLink = `${portalBaseUrl}/verify?token=${rawToken}`;
    const dedupeKey = `verify:issue:${signupRequestId}:${tokenHash.slice(0, 16)}`;

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);

      // Invalidate all outstanding tokens for this signup request
      await tx
        .update(portalVerificationTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(portalVerificationTokens.signupRequestId, signupRequestId),
            isNull(portalVerificationTokens.consumedAt),
          ),
        );

      // Insert the new token (hash only)
      await tx.insert(portalVerificationTokens).values({
        tokenId,
        signupRequestId,
        tenantId,
        tokenHash,
        expiresAt,
      });

      // Enqueue verification email via notifications outbox
      await tx
        .insert(notifications)
        .values({
          tenantId,
          recipientEmail: email,
          channel: 'email',
          templateKey: VERIFICATION_TEMPLATE_KEY,
          payload: {
            applicantName: applicantName ?? email,
            organizationName: organizationName ?? null,
            verifyLink,
            expiryHours: TOKEN_TTL_HOURS,
          },
          dedupeKey,
          status: 'queued',
        })
        .onConflictDoNothing();

      // Update verification_email_status on signup request
      await tx
        .update(portalSignupRequests)
        .set({ verificationEmailStatus: 'sent', updatedAt: new Date() })
        .where(eq(portalSignupRequests.id, signupRequestId));
    });

    this.logger.log({
      type: 'audit',
      event: 'portal.verification.issued',
      signupRequestId,
      tenantId,
      tokenId,
    });

    return { tokenId, expiresAt };
  }

  /**
   * Redeems a verification token.
   * On success: creates portal user, marks token consumed, writes audit + outbox.
   * Returns access token and sets refresh session.
   */
  async redeem(rawToken: string, tenantId: string): Promise<RedeemResult> {
    // Check 60s idempotency cache first (handles prefetch / double-click)
    const cachedResult = await this.getIdempotencyResult(rawToken);
    if (cachedResult) {
      return cachedResult;
    }

    // Look up token by hash (row_security off since tenant not known yet)
    const tokenHash = this.computeTokenHash(rawToken);

    let tokenRow: typeof portalVerificationTokens.$inferSelect | undefined;
    let signupRow: typeof portalSignupRequests.$inferSelect | undefined;

    await this.db.transaction(async (tx) => {
      // Bypass RLS to find the token without tenant context
      await tx.execute(sql`SET LOCAL row_security = off`);

      const tokenRows = await tx
        .select()
        .from(portalVerificationTokens)
        .where(eq(portalVerificationTokens.tokenHash, tokenHash))
        .limit(1);

      tokenRow = tokenRows[0];
      if (!tokenRow) return;

      const signupRows = await tx
        .select()
        .from(portalSignupRequests)
        .where(eq(portalSignupRequests.id, tokenRow.signupRequestId))
        .limit(1);

      signupRow = signupRows[0];
    });

    if (!tokenRow || !signupRow) {
      this.logger.warn({ event: 'portal.verification.invalid', reason: 'token_not_found' });
      throw new BadRequestException({
        code: ErrorCode.VERIFICATION_TOKEN_INVALID,
        message: 'Verification token is invalid.',
      });
    }

    // Check signature / hash validity
    const verifyResult = verifyToken({
      rawToken,
      storedHash: tokenRow.tokenHash,
      expiresAt: tokenRow.expiresAt,
    });

    if (!verifyResult.hashMatch) {
      this.logger.warn({
        event: 'portal.verification.tampered',
        signupRequestId: tokenRow.signupRequestId,
      });
      throw new BadRequestException({
        code: ErrorCode.VERIFICATION_TOKEN_INVALID,
        message: 'Verification token is invalid.',
      });
    }

    if (tokenRow.consumedAt !== null) {
      throw new GoneException({
        code: ErrorCode.VERIFICATION_TOKEN_CONSUMED,
        message: 'Verification token has already been used.',
      });
    }

    if (verifyResult.expired) {
      throw new GoneException({
        code: ErrorCode.VERIFICATION_TOKEN_EXPIRED,
        message: 'Verification token has expired. Request a new verification email.',
        resendAffordance: true,
      });
    }

    if (signupRow.status === 'verified') {
      throw new GoneException({
        code: ErrorCode.VERIFICATION_TOKEN_CONSUMED,
        message: 'Verification token has already been used.',
      });
    }

    const resolvedTenantId = tokenRow.tenantId ?? signupRow.tenantId;
    const userId = randomUUID();
    const now = new Date();

    // Atomic transaction: consume token + create user + audit + outbox event
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant', ${resolvedTenantId}, true)`);

      // Atomic consume: only succeeds if consumed_at IS NULL (concurrent-safe)
      const consumed = await tx
        .update(portalVerificationTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(portalVerificationTokens.tokenId, tokenRow!.tokenId),
            isNull(portalVerificationTokens.consumedAt),
          ),
        )
        .returning({ tokenId: portalVerificationTokens.tokenId });

      if (consumed.length === 0) {
        // Another concurrent request consumed this token first
        throw new GoneException({
          code: ErrorCode.VERIFICATION_TOKEN_CONSUMED,
          message: 'Verification token has already been used.',
        });
      }

      // Create portal user
      await tx.insert(portalUsers).values({
        id: userId,
        tenantId: resolvedTenantId,
        organizationId: signupRow!.organizationId ?? null,
        signupRequestId: signupRow!.id,
        email: signupRow!.email,
        emailHash: signupRow!.emailHash,
        roles: [PORTAL_USER_ROLE],
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      // Mark signup request verified
      await tx
        .update(portalSignupRequests)
        .set({ status: 'verified', verifiedAt: now, updatedAt: now })
        .where(eq(portalSignupRequests.id, signupRow!.id));

      // Audit log
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        tenantId: resolvedTenantId,
        actorId: userId,
        actorKind: 'portal_user',
        action: 'portal_user.verified',
        resourceType: 'portal_user',
        resourceId: userId,
        outcome: 'success',
        code: 'PORTAL_USER_VERIFIED',
        occurredAt: now,
      });

      // Outbox event: portal_user.verified
      await tx
        .insert(notifications)
        .values({
          tenantId: resolvedTenantId,
          recipientEmail: signupRow!.email,
          channel: 'email',
          templateKey: 'portal.user.verified.event',
          payload: {
            eventType: 'portal_user.verified',
            userId,
            email: signupRow!.email,
            organizationId: signupRow!.organizationId ?? null,
            roles: [PORTAL_USER_ROLE],
            occurredAt: now.toISOString(),
          },
          dedupeKey: `portal_user.verified:${userId}`,
          status: 'queued',
        })
        .onConflictDoNothing();
    });

    // Mint access token
    const { accessToken, expiresIn } = this.tokenService.mintAccessToken({
      userId,
      tenantId: resolvedTenantId,
      roles: [PORTAL_USER_ROLE],
      principalKind: 'portal',
      orgScopeVersion: 0,
    });

    const result: RedeemResult = {
      accessToken,
      expiresIn,
      userId,
      email: signupRow.email,
      organizationId: signupRow.organizationId ?? null,
      roles: [PORTAL_USER_ROLE],
      onboardingRequired: true,
    };

    // Store 60-second idempotency result
    await this.setIdempotencyResult(rawToken, result);

    this.logger.log({
      type: 'audit',
      event: 'portal.verification.redeemed',
      userId,
      tenantId: resolvedTenantId,
    });

    return result;
  }

  /**
   * Resend a verification email for a pending signup request.
   * Returns 202 regardless of whether a pending request exists (anti-enumeration).
   * Rate limited: 3 per hour, 5 per 24 hours per email.
   */
  async resend(email: string, tenantId: string): Promise<ResendResult> {
    const emailHash = hashEmail(email);

    await this.checkResendThrottle(emailHash);

    // Look up the pending signup request
    const signupRows = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL row_security = off`);
      return tx
        .select()
        .from(portalSignupRequests)
        .where(
          and(
            eq(portalSignupRequests.tenantId, tenantId),
            eq(portalSignupRequests.emailHash, emailHash),
            eq(portalSignupRequests.status, 'pending_verification'),
          ),
        )
        .limit(1);
    });

    if (signupRows.length > 0) {
      const signup = signupRows[0];
      await this.issue({
        signupRequestId: signup.id,
        tenantId: signup.tenantId,
        email: signup.email,
        applicantName: signup.applicantName ?? null,
        organizationId: signup.organizationId ?? null,
      });

      // Increment resend counters
      await this.incrementResendCounters(emailHash);
    }
    // Generic response regardless of whether request exists (anti-enumeration)
    return { status: 'accepted' };
  }

  /**
   * Records a failed verification attempt and checks for lockout.
   * Throws TooManyRequestsException when the lockout threshold is reached.
   */
  async recordFailedAttempt(emailHash: string): Promise<void> {
    const lockKey = `verify:lock:${emailHash}`;
    const countKey = `verify:fail:${emailHash}`;

    const isLocked = await this.redis.exists(lockKey);
    if (isLocked) {
      const retryAfter = await this.redis.ttl(lockKey);
      const response = new TooManyRequestsException({
        code: ErrorCode.AUTH_RATE_LIMITED,
        message: 'Too many failed verification attempts.',
      });
      (response as any).retryAfter = Math.max(retryAfter, 0);
      throw response;
    }

    const count = await this.redis.incr(countKey);
    if (count === 1) {
      await this.redis.expire(countKey, FAILED_ATTEMPT_WINDOW_S);
    }

    if (count >= FAILED_ATTEMPT_LIMIT) {
      await this.redis.set(lockKey, '1', 'EX', LOCKOUT_TTL_S);
      await this.redis.del(countKey);
      throw new TooManyRequestsException({
        code: ErrorCode.AUTH_RATE_LIMITED,
        message: 'Too many failed verification attempts. Try again in 15 minutes.',
      });
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private computeTokenHash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private async getIdempotencyResult(rawToken: string): Promise<RedeemResult | null> {
    try {
      const key = `verify:done:${this.computeTokenHash(rawToken).slice(0, 32)}`;
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as RedeemResult;
    } catch {
      // Redis unavailable: proceed without cache
    }
    return null;
  }

  private async setIdempotencyResult(rawToken: string, result: RedeemResult): Promise<void> {
    try {
      const key = `verify:done:${this.computeTokenHash(rawToken).slice(0, 32)}`;
      // Store without access token (not safe to cache full token material)
      const { accessToken: _at, ...safeResult } = result;
      await this.redis.set(key, JSON.stringify({ ...safeResult, accessToken: '[CACHED]' }), 'EX', IDEMPOTENCY_TTL_S);
    } catch {
      // Redis unavailable: tolerable, idempotency falls back to DB check
    }
  }

  private async checkResendThrottle(emailHash: string): Promise<void> {
    const lockKey = `verify:lock:${emailHash}`;
    const hourKey = `resend:hour:${emailHash}`;
    const dayKey = `resend:day:${emailHash}`;

    const isLocked = await this.redis.exists(lockKey);
    if (isLocked) {
      const retryAfter = await this.redis.ttl(lockKey);
      const ex = new TooManyRequestsException({
        code: ErrorCode.AUTH_RATE_LIMITED,
        message: 'Resend is temporarily locked.',
      });
      (ex as any).retryAfter = Math.max(retryAfter, 0);
      throw ex;
    }

    const hourCount = parseInt((await this.redis.get(hourKey)) ?? '0', 10);
    if (hourCount >= RESEND_HOURLY_LIMIT) {
      const retryAfter = await this.redis.ttl(hourKey);
      const ex = new TooManyRequestsException({
        code: ErrorCode.AUTH_RATE_LIMITED,
        message: 'Too many resend requests. Try again later.',
      });
      (ex as any).retryAfter = Math.max(retryAfter, 0);
      throw ex;
    }

    const dayCount = parseInt((await this.redis.get(dayKey)) ?? '0', 10);
    if (dayCount >= RESEND_DAILY_LIMIT) {
      const retryAfter = await this.redis.ttl(dayKey);
      const ex = new TooManyRequestsException({
        code: ErrorCode.AUTH_RATE_LIMITED,
        message: 'Daily resend limit reached.',
      });
      (ex as any).retryAfter = Math.max(retryAfter, 0);
      throw ex;
    }
  }

  private async incrementResendCounters(emailHash: string): Promise<void> {
    try {
      const hourKey = `resend:hour:${emailHash}`;
      const dayKey = `resend:day:${emailHash}`;
      const hourCount = await this.redis.incr(hourKey);
      if (hourCount === 1) await this.redis.expire(hourKey, RESEND_HOURLY_WINDOW_S);
      const dayCount = await this.redis.incr(dayKey);
      if (dayCount === 1) await this.redis.expire(dayKey, RESEND_DAILY_WINDOW_S);
    } catch {
      // Redis unavailable: allow through
    }
  }
}
