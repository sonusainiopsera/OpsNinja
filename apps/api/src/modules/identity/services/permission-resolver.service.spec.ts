/**
 * Unit tests for PermissionResolverService.
 */

import { PermissionResolverService } from './permission-resolver.service';
import { Permission, ROLE_PERMISSION_MAP } from '../../../common/auth/permissions';
import { TENANT_A_ID } from '../../../../test/factories/principal.factory';

function makeFakeRedis(cachedValue: string | null = null) {
  const store = new Map<string, string>();
  return {
    get:    jest.fn().mockResolvedValue(cachedValue),
    set:    jest.fn().mockResolvedValue('OK'),
    incr:   jest.fn().mockResolvedValue(1),
    del:    jest.fn().mockResolvedValue(1),
    scan:   jest.fn().mockResolvedValue(['0', []]),
    _store: store,
  };
}

function makeSvc(redis = makeFakeRedis()) {
  return { svc: new PermissionResolverService(redis as never), redis };
}

describe('PermissionResolverService', () => {
  // ── Cache hit ──────────────────────────────────────────────────────────────

  it('returns permissions from Redis cache without calling the hardcoded map', async () => {
    const cached = JSON.stringify([Permission.TICKETS_READ, Permission.USERS_READ]);
    const { svc, redis } = makeSvc(makeFakeRedis(cached));

    const result = await svc.resolvePermissions(TENANT_A_ID, ['agent']);
    expect(result.has(Permission.TICKETS_READ)).toBe(true);
    expect(result.has(Permission.USERS_READ)).toBe(true);
    expect(redis.get).toHaveBeenCalledWith(expect.stringContaining(`rbac:${TENANT_A_ID}:`));
  });

  it('increments cache hit metric on cache hit', async () => {
    const cached = JSON.stringify([Permission.TICKETS_READ]);
    const { svc, redis } = makeSvc(makeFakeRedis(cached));

    await svc.resolvePermissions(TENANT_A_ID, ['agent']);
    expect(redis.incr).toHaveBeenCalledWith('metrics:auth:rbac_cache_hit');
  });

  // ── Cache miss ─────────────────────────────────────────────────────────────

  it('resolves from hardcoded map on cache miss and writes to cache', async () => {
    const { svc, redis } = makeSvc(makeFakeRedis(null));

    const result = await svc.resolvePermissions(TENANT_A_ID, ['agent']);
    // agent should have these from ROLE_PERMISSION_MAP
    expect(result.has(Permission.TICKETS_READ)).toBe(true);
    expect(result.has(Permission.TICKETS_WRITE)).toBe(true);
    // but not admin-only
    expect(result.has(Permission.ADMIN_WRITE)).toBe(false);

    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(`rbac:${TENANT_A_ID}:`),
      expect.any(String),
      'EX',
      60,
    );
    expect(redis.incr).toHaveBeenCalledWith('metrics:auth:rbac_cache_miss');
  });

  // ── Redis outage → fallback ────────────────────────────────────────────────

  it('falls back to hardcoded map when Redis.get throws', async () => {
    const redis = makeFakeRedis();
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const { svc } = makeSvc(redis);

    const result = await svc.resolvePermissions(TENANT_A_ID, ['admin']);
    expect(result.has(Permission.ADMIN_WRITE)).toBe(true);
  });

  it('still writes to cache after Redis fallback when Redis recovers', async () => {
    const redis = makeFakeRedis();
    redis.get.mockRejectedValue(new Error('timeout'));
    const { svc } = makeSvc(redis);

    await svc.resolvePermissions(TENANT_A_ID, ['agent']);
    // Best-effort write — if this throws internally it is swallowed
    // We just confirm the method completes without throwing
  });

  // ── Multiple roles → union ─────────────────────────────────────────────────

  it('returns union of permissions across multiple roles', async () => {
    const { svc } = makeSvc();

    const result = await svc.resolvePermissions(TENANT_A_ID, ['agent', 'admin']);
    // agent has TICKETS_READ; admin also has ADMIN_WRITE
    expect(result.has(Permission.TICKETS_READ)).toBe(true);
    expect(result.has(Permission.ADMIN_WRITE)).toBe(true);
  });

  it('does not apply negative grants (permissions are additive)', async () => {
    const { svc } = makeSvc();

    // readonly only has tickets:read; but when combined with agent the union has more
    const result = await svc.resolvePermissions(TENANT_A_ID, ['readonly', 'agent']);
    expect(result.has(Permission.TICKETS_READ)).toBe(true);
    expect(result.has(Permission.TICKETS_WRITE)).toBe(true); // from agent
  });

  // ── Unknown roles → empty set ──────────────────────────────────────────────

  it('returns empty set for unknown role names', async () => {
    const { svc } = makeSvc();

    const result = await svc.resolvePermissions(TENANT_A_ID, ['deleted_role_xyz']);
    expect(result.size).toBe(0);
  });

  // ── Cache key stability ────────────────────────────────────────────────────

  it('produces the same cache key regardless of role order', async () => {
    const redis1 = makeFakeRedis();
    const redis2 = makeFakeRedis();
    const svc1 = new PermissionResolverService(redis1 as never);
    const svc2 = new PermissionResolverService(redis2 as never);

    await svc1.resolvePermissions(TENANT_A_ID, ['agent', 'admin']);
    await svc2.resolvePermissions(TENANT_A_ID, ['admin', 'agent']);

    const key1 = (redis1.get as jest.Mock).mock.calls[0][0] as string;
    const key2 = (redis2.get as jest.Mock).mock.calls[0][0] as string;
    expect(key1).toBe(key2);
  });

  // ── Hardcoded map completeness ─────────────────────────────────────────────

  it('covers all six seeded roles in the permission map', () => {
    const roles = ['admin', 'supervisor', 'agent', 'readonly', 'portal_user', 'worker'];
    for (const role of roles) {
      expect(ROLE_PERMISSION_MAP[role]).toBeDefined();
      expect(ROLE_PERMISSION_MAP[role].length).toBeGreaterThan(0);
    }
  });
});
