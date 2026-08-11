/**
 * OrgScopeService — resolves and caches an agent's allowed organization IDs.
 *
 * Cache key pattern: tenant:{tenantId}:user:{userId}:scopes:v{scopeVersion}
 *   TTL: 60 seconds
 *   Version bumps make old cache keys unreachable without explicit deletion.
 *
 * Version counter key: tenant:{tenantId}:user:{userId}:scope_version
 *   Atomic Redis INCR ensures no version is lost under concurrent mutations.
 *   On cold start (key absent), the counter is seeded from the DB persisted
 *   scope_version to prevent every token appearing stale.
 *
 * Redis outage: falls back to DB read; never skips the filter.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import type Redis from 'ioredis';

import { db, agentOrgScopes } from '@opsninja/db';
import { REDIS_CLIENT } from '../redis/redis.provider';

const SCOPE_TTL_SECONDS = 60;
const SCOPE_KEY_PREFIX = 'tenant';

@Injectable()
export class OrgScopeService {
  private readonly logger = new Logger(OrgScopeService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Returns the current scope_version counter for the user from Redis.
   * On cache miss seeds from the DB persisted value (cold start / eviction).
   * Returns 0 if the user has no scope rows at all (new user — valid initial state).
   */
  async getScopeVersion(tenantId: string, userId: string): Promise<number> {
    const counterKey = this.versionCounterKey(tenantId, userId);
    try {
      const cached = await this.redis.get(counterKey);
      if (cached !== null) return parseInt(cached, 10);
    } catch (err) {
      this.logger.warn('Redis unavailable reading scope_version; falling back to DB', {
        tenantId,
        userId,
        error: (err as Error).message,
      });
    }

    // Seed from DB
    const dbVersion = await this.fetchMaxScopeVersionFromDb(tenantId, userId);
    try {
      await this.redis.set(counterKey, String(dbVersion));
    } catch {
      /* best-effort — non-fatal */
    }
    return dbVersion;
  }

  /**
   * Returns the set of organization IDs the user is permitted to access.
   * Uses version-keyed Redis cache (60s TTL); falls back to DB on miss or
   * Redis outage.
   *
   * @param tenantId       Tenant scoping the lookup.
   * @param userId         The agent whose scopes to load.
   * @param scopeVersion   The version carried in the access token.
   */
  async getScopeIds(
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
      this.logger.warn('Redis unavailable reading org scope ids; falling back to DB', {
        tenantId,
        userId,
        error: (err as Error).message,
      });
    }

    // DB fallback
    const ids = await this.fetchScopeIdsFromDb(tenantId, userId);

    // Cache best-effort
    try {
      await this.redis.set(cacheKey, JSON.stringify(ids), 'EX', SCOPE_TTL_SECONDS);
    } catch {
      /* best-effort */
    }

    return ids;
  }

  /**
   * Atomically bumps the scope_version counter for a user in Redis.
   * Returns the new version number.
   */
  async bumpScopeVersion(tenantId: string, userId: string): Promise<number> {
    const counterKey = this.versionCounterKey(tenantId, userId);
    try {
      const newVersion = await this.redis.incr(counterKey);
      return newVersion;
    } catch (err) {
      this.logger.warn('Redis unavailable incrementing scope_version; deriving from DB', {
        tenantId,
        userId,
        error: (err as Error).message,
      });
      const dbVersion = await this.fetchMaxScopeVersionFromDb(tenantId, userId);
      return dbVersion + 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private scopeCacheKey(tenantId: string, userId: string, scopeVersion: number): string {
    return `${SCOPE_KEY_PREFIX}:${tenantId}:user:${userId}:scopes:v${scopeVersion}`;
  }

  private versionCounterKey(tenantId: string, userId: string): string {
    return `${SCOPE_KEY_PREFIX}:${tenantId}:user:${userId}:scope_version`;
  }

  private async fetchScopeIdsFromDb(tenantId: string, userId: string): Promise<string[]> {
    const rows = await db
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

  private async fetchMaxScopeVersionFromDb(tenantId: string, userId: string): Promise<number> {
    const rows = await db
      .select({ scopeVersion: agentOrgScopes.scopeVersion })
      .from(agentOrgScopes)
      .where(
        and(
          eq(agentOrgScopes.tenantId, tenantId),
          eq(agentOrgScopes.userId, userId),
        ),
      )
      .limit(1);
    return rows[0]?.scopeVersion ?? 0;
  }
}
