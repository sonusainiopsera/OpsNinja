import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.provider';
import { ROLE_PERMISSION_MAP } from '../../../common/auth/permissions';

const CACHE_TTL_S = 60;

@Injectable()
export class PermissionResolverService {
  private readonly logger = new Logger(PermissionResolverService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Returns the effective permission set for a principal with the given roles.
   *
   * Resolution order:
   *   1. Redis cache (rbac:{tenantId}:{roleSetHash}, 60-second TTL)
   *   2. Hardcoded role→permission map (Postgres fallback until WO populates DB table)
   *
   * Never fails open: any unhandled exception from both paths propagates to the
   * caller so the guard can convert it into a 403 denial.
   */
  async resolvePermissions(tenantId: string, roles: string[]): Promise<Set<string>> {
    const cacheKey = this.buildCacheKey(tenantId, roles);
    let cacheHit = false;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) {
        cacheHit = true;
        this.incrementMetric('metrics:auth:rbac_cache_hit');
        return new Set(JSON.parse(cached) as string[]);
      }
    } catch (err) {
      this.logger.warn('RBAC Redis cache unavailable, falling back to Postgres', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.incrementMetric('metrics:auth:rbac_cache_miss');

    const permissions = this.resolveFromHardcodedMap(roles);

    if (!cacheHit) {
      // Best-effort cache write — failure is non-fatal
      this.redis
        .set(cacheKey, JSON.stringify([...permissions]), 'EX', CACHE_TTL_S)
        .catch(() => {});
    }

    return permissions;
  }

  /**
   * Invalidates all RBAC cache entries for a tenant.
   * Call after role assignment changes to ensure stale permissions are not served.
   */
  async invalidateCache(tenantId: string): Promise<void> {
    // Pattern-based scan to find all keys for this tenant.
    // In a Redis Cluster environment this would need SCAN with a hash tag.
    try {
      const pattern = `rbac:${tenantId}:*`;
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      this.logger.warn('Failed to invalidate RBAC cache', { tenantId, error: String(err) });
    }
  }

  private resolveFromHardcodedMap(roles: string[]): Set<string> {
    const permSet = new Set<string>();
    for (const role of roles) {
      const perms = ROLE_PERMISSION_MAP[role] ?? [];
      perms.forEach((p) => permSet.add(p));
    }
    return permSet;
  }

  private buildCacheKey(tenantId: string, roles: string[]): string {
    const sortedRoles = [...roles].sort().join(',');
    const roleSetHash = createHash('sha256').update(sortedRoles).digest('hex').slice(0, 16);
    return `rbac:${tenantId}:${roleSetHash}`;
  }

  private incrementMetric(key: string): void {
    this.redis.incr(key).catch(() => {});
  }
}
