/**
 * OnboardingRequiredGuard — WO-088.
 *
 * Server-side enforcement of the onboarding gate. Runs after the global
 * AuthGuard but before TenantContextInterceptor.
 *
 * Behaviour:
 *   - Only applies to portal principals (principalKind === 'portal').
 *   - Wizard routes (/portal/onboarding/**) are always allowed through.
 *   - Read-only (GET/HEAD) endpoints are allowed through per the spec.
 *   - All other portal write endpoints return HTTP 403 code
 *     ONBOARDING_REQUIRED until the wizard is marked complete.
 *
 * Performance:
 *   Completion status is cached in Redis under
 *   portal:onboarding:complete:{tenantId}:{userId} with a 5-minute TTL.
 *   On cache miss, a raw pool query fetches the completion timestamp.
 *   The key is written on first complete check and invalidated by the
 *   PortalOnboardingService when onboarding completes.
 *
 * Security:
 *   - The guard fails closed (denies) on any unexpected error.
 *   - Caching an incomplete state is safe: a partial cache entry causes a
 *     DB re-check, not a bypass.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { pool } from '@opsninja/db';

import { REDIS_CLIENT } from '../../../common/redis/redis.provider';
import type { AuthenticatedPrincipal } from '../../../common/auth/auth.guard';

/** Redis TTL for the onboarding-complete flag (seconds). */
const ONBOARDING_CACHE_TTL_SECONDS = 300; // 5 minutes

/** URL path prefix for wizard routes that are always allowed. */
const ONBOARDING_PATH_PREFIX = '/api/v1/portal/onboarding';

@Injectable()
export class OnboardingRequiredGuard implements CanActivate {
  private readonly logger = new Logger(OnboardingRequiredGuard.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedPrincipal }>();
    const principal = request.user;

    // Only gate portal principals
    if (!principal || principal.principalKind !== 'portal') {
      return true;
    }

    // Wizard routes are always allowed (portal/onboarding**)
    const path = request.path ?? '';
    if (path.startsWith(ONBOARDING_PATH_PREFIX)) {
      return true;
    }

    // Read-only methods pass through per spec (AC-7 allows ticket list)
    const method = (request.method ?? '').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }

    // Check Redis cache first
    const cacheKey = this.cacheKey(principal.tenantId, principal.sub);
    const cached = await this.tryGetCache(cacheKey);
    if (cached === true) {
      // Onboarding complete — allow through
      return true;
    }

    // Cache miss or false — check DB
    const complete = await this.isOnboardingComplete(principal.tenantId, principal.sub);

    if (complete) {
      // Populate cache for future requests
      await this.setCache(cacheKey);
      return true;
    }

    const traceId = (request.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    this.logger.log('Onboarding not complete — blocking portal write', {
      tenantId: principal.tenantId,
      userId: principal.sub,
      path,
      traceId,
    });

    throw new ForbiddenException({
      error: {
        code: 'ONBOARDING_REQUIRED',
        message:
          'You must complete onboarding before accessing other portal features.',
        traceId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Redis helpers
  // ---------------------------------------------------------------------------

  private cacheKey(tenantId: string, userId: string): string {
    return `portal:onboarding:complete:${tenantId}:${userId}`;
  }

  private async tryGetCache(key: string): Promise<boolean | null> {
    try {
      const val = await this.redis.get(key);
      if (val === '1') return true;
      if (val === '0') return false;
      return null;
    } catch {
      // Non-fatal — fall through to DB check
      return null;
    }
  }

  private async setCache(key: string): Promise<void> {
    try {
      await this.redis.setex(key, ONBOARDING_CACHE_TTL_SECONDS, '1');
    } catch {
      // Non-fatal — cache write failure
    }
  }

  /**
   * Invalidate the onboarding-complete cache for a user.
   * Called by PortalOnboardingService after wizard completion.
   */
  async invalidateCache(tenantId: string, userId: string): Promise<void> {
    try {
      await this.redis.del(this.cacheKey(tenantId, userId));
    } catch {
      // Non-fatal
    }
  }

  // ---------------------------------------------------------------------------
  // DB check — uses raw pool with explicit tenant context
  // ---------------------------------------------------------------------------

  private async isOnboardingComplete(tenantId: string, userId: string): Promise<boolean> {
    const client = await pool.connect();
    try {
      // Bootstrap access: set portal_signup_bootstrap to allow cross-tenant read
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

      const result = await client.query<{ completed_at: Date | null }>(
        `SELECT completed_at
         FROM portal_onboarding_states
         WHERE tenant_id = $1
           AND user_id = $2
         LIMIT 1`,
        [tenantId, userId],
      );

      if (result.rows.length === 0) {
        // No state row — onboarding not started
        return false;
      }

      return result.rows[0]!.completed_at !== null;
    } catch (err) {
      // Fail closed on DB error
      this.logger.error('OnboardingRequiredGuard DB check failed — failing closed', {
        error: (err as Error).message,
        tenantId,
        userId,
      });
      return false;
    } finally {
      client.release();
    }
  }
}
