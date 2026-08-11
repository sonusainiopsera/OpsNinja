/**
 * PermissionResolverService — maps a set of roles to a permission set.
 *
 * Hot path design:
 *   1. Check Redis cache key rbac:{tenantId}:{roleSetHash} (60-second TTL).
 *   2. On miss: compute from the in-memory ROLE_PERMISSIONS map
 *      (Postgres fallback placeholder — WOREF-009 will add a DB read here).
 *   3. On Redis outage: compute directly without caching; never fail open.
 *
 * Permissions are additive: the user receives the union of all role sets.
 * There are no negative (deny) grants.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.provider';
import { type Permission, ROLE_PERMISSIONS } from './permission.catalog';

const CACHE_TTL_SECONDS = 60;
const CACHE_KEY_PREFIX = 'rbac';

@Injectable()
export class PermissionResolverService {
  private readonly logger = new Logger(PermissionResolverService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Resolve the effective permission set for the given roles.
   * Never throws — Redis outage falls back to in-memory computation.
   */
  async resolve(tenantId: string, roles: string[]): Promise<Set<Permission>> {
    const cacheKey = this.buildCacheKey(tenantId, roles);

    // 1. Check Redis cache
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return new Set<Permission>(JSON.parse(cached) as Permission[]);
      }
    } catch (err) {
      this.logger.warn('Redis unavailable for permission cache; using in-memory fallback', {
        tenantId,
        error: (err as Error).message,
      });
    }

    // 2. Compute from ROLE_PERMISSIONS (Postgres fallback placeholder)
    const permissions = this.computeFromRoles(roles);

    // 3. Cache result (best-effort — non-fatal if Redis is down)
    this.cachePermissions(cacheKey, permissions).catch(() => {
      /* already logged in cachePermissions */
    });

    return permissions;
  }

  /**
   * Explicitly invalidate the permission cache for a tenant.
   * Called when role assignments change so the next request re-resolves from DB.
   * Uses SCAN to avoid blocking the Redis server with KEYS.
   */
  async invalidateForTenant(tenantId: string): Promise<void> {
    const pattern = `${CACHE_KEY_PREFIX}:${tenantId}:*`;
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
      this.logger.log(`Permission cache invalidated for tenant ${tenantId}`);
    } catch (err) {
      this.logger.warn(`Failed to invalidate permission cache for tenant ${tenantId}`, {
        error: (err as Error).message,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private computeFromRoles(roles: string[]): Set<Permission> {
    const permissions = new Set<Permission>();
    for (const role of roles) {
      const rolePerms = ROLE_PERMISSIONS[role];
      if (rolePerms) {
        for (const perm of rolePerms) {
          permissions.add(perm);
        }
      }
    }
    return permissions;
  }

  private buildCacheKey(tenantId: string, roles: string[]): string {
    const sorted = [...roles].sort().join(',');
    const hash = createHash('sha256').update(sorted).digest('hex').slice(0, 16);
    return `${CACHE_KEY_PREFIX}:${tenantId}:${hash}`;
  }

  private async cachePermissions(key: string, permissions: Set<Permission>): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify([...permissions]), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn('Failed to cache permission set in Redis', {
        error: (err as Error).message,
      });
    }
  }
}
