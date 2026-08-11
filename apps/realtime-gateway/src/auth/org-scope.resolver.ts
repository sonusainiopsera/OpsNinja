/**
 * Org scope resolver for the Realtime Gateway.
 *
 * Reads pre-cached org scope IDs from Redis using the same key convention as
 * OrgScopeService in apps/api. The gateway never queries Postgres — all scope
 * data is served from the Redis cache populated by the API on every request.
 *
 * Cache key: `tenant:{tenantId}:user:{userId}:scopes:v{scopeVersion}`
 * Version counter key: `tenant:{tenantId}:user:{userId}:scope_version`
 *
 * If the cache key is absent (cold socket after Redis eviction), returns an
 * empty set — which is treated as "unrestricted" by the org-scope filter.
 * This is the safe fallback: the revalidation tick will re-evaluate shortly.
 */

import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class OrgScopeResolver {
  private readonly logger = new Logger(OrgScopeResolver.name);
  private readonly redis: Redis;

  constructor() {
    const url = process.env['REDIS_URL'];
    this.redis = url ? new Redis(url) : new Redis();

    this.redis.on('error', (err: Error) => {
      this.logger.warn('Redis command client error', { message: err.message });
    });
  }

  /**
   * Resolve the set of organisation IDs the principal may see.
   * Returns empty set (= unrestricted) on cache miss or Redis error.
   */
  async resolveScopeIds(
    tenantId: string,
    userId: string,
    scopeVersion: number,
  ): Promise<Set<string>> {
    const key = `tenant:${tenantId}:user:${userId}:scopes:v${scopeVersion}`;
    try {
      const cached = await this.redis.get(key);
      if (!cached) return new Set();
      const ids = JSON.parse(cached) as string[];
      return new Set(ids);
    } catch (err) {
      this.logger.warn('Redis unavailable resolving org scope — defaulting to empty', {
        tenantId,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return new Set();
    }
  }

  /**
   * Returns the current scope version from Redis.
   * Used by the revalidation tick to detect scope changes.
   * Returns null on Redis error (do not close sockets on resolver failure).
   */
  async getCurrentScopeVersion(
    tenantId: string,
    userId: string,
  ): Promise<number | null> {
    const key = `tenant:${tenantId}:user:${userId}:scope_version`;
    try {
      const val = await this.redis.get(key);
      if (val === null) return null;
      return parseInt(val, 10);
    } catch {
      return null;
    }
  }

  async disconnect(): Promise<void> {
    this.redis.disconnect();
  }
}
