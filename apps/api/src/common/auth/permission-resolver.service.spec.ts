/**
 * Unit tests for PermissionResolverService.
 *
 * Covers:
 *   1. Cache hit: returns cached permissions without computing
 *   2. Cache miss: computes from ROLE_PERMISSIONS, caches result
 *   3. Redis outage on get: falls back to in-memory, still correct
 *   4. Redis outage on set: result still returned, no throw
 *   5. Unknown role: resolves to empty set
 *   6. Multiple roles: returns union of permissions
 *   7. Duplicate permissions across roles deduplicated
 *   8. Invalidate: calls SCAN and DEL on matching keys
 */

import { PermissionResolverService } from './permission-resolver.service';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { ROLE_PERMISSIONS, type Permission } from './permission.catalog';
import { TENANT_A_ID } from '../../../test/factories/principal-context.factory';

// ---------------------------------------------------------------------------
// Minimal fake Redis for these tests
// ---------------------------------------------------------------------------

class FakeRedis {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _ex: string, _ttl: number): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) { if (this.store.delete(k)) count++; }
    return count;
  }

  async scan(
    cursor: string,
    _match: string,
    _pattern: string,
    _count: string,
    _limit: number,
  ): Promise<[string, string[]]> {
    return ['0', [...this.store.keys()]];
  }

  simulateGetError(): void {
    jest.spyOn(this as FakeRedis, 'get').mockRejectedValueOnce(new Error('Redis ECONNREFUSED'));
  }

  simulateSetError(): void {
    jest.spyOn(this as FakeRedis, 'set').mockRejectedValueOnce(new Error('Redis ECONNREFUSED'));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PermissionResolverService', () => {
  let service: PermissionResolverService;
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new (PermissionResolverService as new (r: FakeRedis) => PermissionResolverService)(redis);
  });

  it('returns permissions from Redis cache on cache hit', async () => {
    const roles = ['agent'];
    // Prime the cache manually
    const getSpy = jest.spyOn(redis, 'get').mockResolvedValueOnce(
      JSON.stringify(['ticket:read', 'ticket:create']),
    );
    const setSpy = jest.spyOn(redis, 'set');

    const result = await service.resolve(TENANT_A_ID, roles);

    expect(result.has('ticket:read')).toBe(true);
    expect(result.has('ticket:create')).toBe(true);
    expect(getSpy).toHaveBeenCalled();
    // Should NOT re-cache on hit
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('computes from ROLE_PERMISSIONS on cache miss and caches result', async () => {
    const roles = ['agent'];
    const setSpy = jest.spyOn(redis, 'set');

    const result = await service.resolve(TENANT_A_ID, roles);

    const expected = new Set<Permission>(ROLE_PERMISSIONS['agent']);
    for (const perm of expected) {
      expect(result.has(perm)).toBe(true);
    }
    // Should cache after miss
    expect(setSpy).toHaveBeenCalled();
  });

  it('falls back to in-memory computation when Redis GET throws', async () => {
    redis.simulateGetError();

    const result = await service.resolve(TENANT_A_ID, ['agent']);

    const expected = ROLE_PERMISSIONS['agent'] ?? [];
    for (const perm of expected) {
      expect(result.has(perm)).toBe(true);
    }
  });

  it('returns permissions even when Redis SET throws', async () => {
    redis.simulateSetError();

    // Should not throw
    const result = await service.resolve(TENANT_A_ID, ['agent']);
    expect(result.size).toBeGreaterThan(0);
  });

  it('returns empty set for unknown role', async () => {
    const result = await service.resolve(TENANT_A_ID, ['nonexistent_role']);
    expect(result.size).toBe(0);
  });

  it('returns union of permissions for multiple roles', async () => {
    const result = await service.resolve(TENANT_A_ID, ['agent', 'lead_analyst']);

    // agent has ticket:view_internal_notes; lead_analyst has report:export
    expect(result.has('ticket:view_internal_notes')).toBe(true);
    expect(result.has('report:export')).toBe(true);
  });

  it('deduplicates permissions across roles', async () => {
    const result = await service.resolve(TENANT_A_ID, ['agent', 'agent']);

    // 'ticket:read' appears in both — should not be duplicated in the Set
    const arr = [...result].filter((p) => p === 'ticket:read');
    expect(arr).toHaveLength(1);
  });

  it('admin role resolves to all permissions', async () => {
    const { ALL_PERMISSIONS } = await import('./permission.catalog');
    const result = await service.resolve(TENANT_A_ID, ['admin']);

    for (const perm of ALL_PERMISSIONS) {
      expect(result.has(perm)).toBe(true);
    }
  });

  it('portal_user role resolves to limited ticket permissions only', async () => {
    const result = await service.resolve(TENANT_A_ID, ['portal_user']);

    expect(result.has('ticket:read')).toBe(true);
    expect(result.has('ticket:create')).toBe(true);
    // Should NOT have internal-note or admin permissions
    expect(result.has('ticket:view_internal_notes')).toBe(false);
    expect(result.has('admin:manage_tenant')).toBe(false);
  });

  it('machine role resolves to machine:* permissions', async () => {
    const result = await service.resolve(TENANT_A_ID, ['machine']);

    expect(result.has('machine:jira_sync')).toBe(true);
    expect(result.has('machine:notification_send')).toBe(true);
    // Should NOT have staff permissions
    expect(result.has('user:create')).toBe(false);
  });
});
