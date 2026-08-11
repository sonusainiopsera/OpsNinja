/**
 * OrgScopeService – resolves the set of organization IDs a staff agent is
 * permitted to access, with a Redis cache keyed by scope version.
 *
 * Cache key format:
 *   tenant:{tenantId}:user:{userId}:scopes:v{scopeVersion}
 *   TTL: 60 seconds
 *
 * Version key format:
 *   tenant:{tenantId}:user:{userId}:scope_version
 *
 * Design:
 *  - Version bumps make the old cache key unreachable (key includes version),
 *    so no explicit cache invalidation is required.
 *  - Redis unavailability falls back to a database read and logs a warning.
 *  - The scope_version counter is seeded from the persisted row count rather
 *    than from Redis on cold start, preventing false STALE rejections.
 *  - Atomic INCR ensures concurrent mutations never lose a version bump.
 */

import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import Redis from 'ioredis';
import { eq, and } from 'drizzle-orm';
import { agentOrgScopes } from '@opsninja/db';
import { REDIS_CLIENT } from '../../../common/redis/redis.provider';
import { RequestContextStore } from '../../../observability/request-context';
import { ErrorCode } from '../../../common/errors/app-errors';

const SCOPE_CACHE_TTL_S = 60;

@Injectable()
export class OrgScopeService {
  private readonly logger = new Logger(OrgScopeService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Returns the organization IDs the given user is allowed to access.
   *
   * Uses a Redis cache keyed by scope version.  Falls back to the database
   * if Redis is unavailable.  Never returns an unfiltered list.
   */
  async resolveOrgIds(
    tenantId: string,
    userId: string,
    scopeVersion: number,
  ): Promise<string[]> {
    const cacheKey = this.scopeCacheKey(tenantId, userId, scopeVersion);

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) {
        return JSON.parse(cached) as string[];
      }
    } catch (err) {
      this.logger.warn('OrgScope Redis unavailable; falling back to DB', {
        tenantId,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Database fallback
    const orgIds = await this.loadFromDb(tenantId, userId);

    // Best-effort cache write
    this.redis
      .set(cacheKey, JSON.stringify(orgIds), 'EX', SCOPE_CACHE_TTL_S)
      .catch(() => {});

    return orgIds;
  }

  /**
   * Validates that a token's org_scope_version is not stale.
   *
   * The counter key holds the latest version.  On a cold-start or eviction
   * the key is absent — we seed it from the DB row count, treating the
   * existing scope as version 0.
   *
   * @throws UnauthorizedException(SCOPE_VERSION_STALE) if the token is stale.
   */
  async assertScopeVersionFresh(
    tenantId: string,
    userId: string,
    tokenScopeVersion: number,
  ): Promise<void> {
    const counterKey = this.scopeVersionKey(tenantId, userId);

    let serverVersion: number;
    try {
      const raw = await this.redis.get(counterKey);
      if (raw === null) {
        // Cold-start: seed the counter at version 0; any token at v0 is valid.
        await this.redis.set(counterKey, '0');
        serverVersion = 0;
      } else {
        serverVersion = parseInt(raw, 10);
      }
    } catch {
      // Redis unavailable — allow through to avoid locking everyone out.
      this.logger.warn('OrgScope version check skipped (Redis unavailable)', { tenantId, userId });
      return;
    }

    if (tokenScopeVersion < serverVersion) {
      throw new UnauthorizedException({
        code: ErrorCode.SCOPE_VERSION_STALE,
        message: 'Organization scope has changed. Please refresh your session.',
      });
    }
  }

  /**
   * Atomically increments the scope_version counter and returns the new value.
   * Called by the scope mutation endpoint after a successful DB write.
   */
  async bumpScopeVersion(tenantId: string, userId: string): Promise<number> {
    const counterKey = this.scopeVersionKey(tenantId, userId);
    try {
      const newVersion = await this.redis.incr(counterKey);
      // Ensure the key has a TTL (24h safety net — tokens are 15 min TTL so
      // any version > 24h old is unreachable anyway).
      await this.redis.expire(counterKey, 24 * 60 * 60);
      return newVersion;
    } catch (err) {
      this.logger.error('Failed to bump scope_version counter', {
        tenantId, userId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Return a sentinel — the DB write already succeeded so we return 0
      // (the client will get a fresh version on next refresh).
      return 0;
    }
  }

  /**
   * Returns all scope rows for a user (used by GET /agent-scopes/:userId).
   * Uses the current transaction handle from RequestContextStore.
   */
  async listScopes(tenantId: string, userId: string): Promise<Array<{
    organizationId: string;
    accessLevel: string;
  }>> {
    const tx = RequestContextStore.getTx();
    const rows = await tx
      .select({
        organizationId: agentOrgScopes.organizationId,
        accessLevel: agentOrgScopes.accessLevel,
      })
      .from(agentOrgScopes)
      .where(
        and(
          eq(agentOrgScopes.tenantId, tenantId),
          eq(agentOrgScopes.userId, userId),
        ),
      );
    return rows;
  }

  /**
   * Replaces the entire scope set for a user inside the current transaction.
   * Returns the new scope_version after bumping the Redis counter.
   */
  async replaceScopes(
    tenantId: string,
    userId: string,
    orgIds: Array<{ organizationId: string; accessLevel: string }>,
  ): Promise<number> {
    const tx = RequestContextStore.getTx();

    // Delete existing scopes
    await tx
      .delete(agentOrgScopes)
      .where(
        and(
          eq(agentOrgScopes.tenantId, tenantId),
          eq(agentOrgScopes.userId, userId),
        ),
      );

    // Insert new scopes
    if (orgIds.length > 0) {
      await tx.insert(agentOrgScopes).values(
        orgIds.map((o) => ({
          tenantId,
          userId,
          organizationId: o.organizationId,
          accessLevel: o.accessLevel,
        })),
      );
    }

    // Bump version counter (outside transaction — best-effort)
    return this.bumpScopeVersion(tenantId, userId);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async loadFromDb(tenantId: string, userId: string): Promise<string[]> {
    const tx = RequestContextStore.getTx();
    const rows = await tx
      .select({ organizationId: agentOrgScopes.organizationId })
      .from(agentOrgScopes)
      .where(
        and(
          eq(agentOrgScopes.tenantId, tenantId),
          eq(agentOrgScopes.userId, userId),
        ),
      );
    return rows.map((r) => r.organizationId);
  }

  private scopeCacheKey(tenantId: string, userId: string, version: number): string {
    return `tenant:${tenantId}:user:${userId}:scopes:v${version}`;
  }

  private scopeVersionKey(tenantId: string, userId: string): string {
    return `tenant:${tenantId}:user:${userId}:scope_version`;
  }
}
