import { UnauthorizedException } from '@nestjs/common';
import { OrgScopeService } from '../org-scope.service';
import { RequestContextStore } from '../../../../observability/request-context';

// ── Redis mock factory ──────────────────────────────────────────────────────

function makeRedisMock(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ...overrides,
  };
}

// ── DB mock factory ──────────────────────────────────────────────────────────

function makeTx(rows: Array<{ organizationId: string }> = []) {
  const selectChain = {
    select: jest.fn(),
    from: jest.fn(),
    where: jest.fn().mockResolvedValue(rows),
  };
  // chain: tx.select(...).from(...).where(...)
  selectChain.select.mockReturnValue(selectChain);
  selectChain.from.mockReturnValue(selectChain);

  const deleteChain = {
    delete: jest.fn(),
    where: jest.fn().mockResolvedValue(undefined),
  };
  deleteChain.delete.mockReturnValue(deleteChain);

  const insertChain = {
    insert: jest.fn(),
    values: jest.fn().mockResolvedValue(undefined),
  };
  insertChain.insert.mockReturnValue(insertChain);

  return {
    select: selectChain.select,
    delete: deleteChain.delete,
    insert: insertChain.insert,
    _selectChain: selectChain,
    _deleteChain: deleteChain,
    _insertChain: insertChain,
  };
}

function withTx(tx: ReturnType<typeof makeTx>) {
  jest.spyOn(RequestContextStore, 'getTx').mockReturnValue(tx as never);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OrgScopeService', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('resolveOrgIds', () => {
    it('returns cached org IDs when Redis has a hit', async () => {
      const orgIds = ['org-1', 'org-2'];
      const redis = makeRedisMock({
        get: jest.fn().mockResolvedValue(JSON.stringify(orgIds)),
      });
      const svc = new OrgScopeService(redis as never);

      const result = await svc.resolveOrgIds('tenant-1', 'user-1', 1);
      expect(result).toEqual(orgIds);
      expect(redis.get).toHaveBeenCalledWith('tenant:tenant-1:user:user-1:scopes:v1');
    });

    it('falls back to DB when Redis returns null', async () => {
      const orgRows = [{ organizationId: 'org-db-1' }];
      const redis = makeRedisMock({ get: jest.fn().mockResolvedValue(null) });
      const tx = makeTx(orgRows);
      withTx(tx);

      const svc = new OrgScopeService(redis as never);
      const result = await svc.resolveOrgIds('tenant-1', 'user-1', 0);
      expect(result).toEqual(['org-db-1']);
    });

    it('falls back to DB when Redis throws', async () => {
      const orgRows = [{ organizationId: 'org-db-2' }];
      const redis = makeRedisMock({
        get: jest.fn().mockRejectedValue(new Error('Redis down')),
        set: jest.fn().mockRejectedValue(new Error('Redis down')),
      });
      const tx = makeTx(orgRows);
      withTx(tx);

      const svc = new OrgScopeService(redis as never);
      const result = await svc.resolveOrgIds('tenant-1', 'user-1', 0);
      expect(result).toEqual(['org-db-2']);
    });

    it('writes the result back to cache after a DB fallback', async () => {
      const orgRows = [{ organizationId: 'org-1' }];
      const redis = makeRedisMock({ get: jest.fn().mockResolvedValue(null) });
      const tx = makeTx(orgRows);
      withTx(tx);

      const svc = new OrgScopeService(redis as never);
      await svc.resolveOrgIds('tenant-1', 'user-1', 2);

      // Best-effort set is called (may be async, so we flush micro-tasks)
      await Promise.resolve();
      expect(redis.set).toHaveBeenCalledWith(
        'tenant:tenant-1:user:user-1:scopes:v2',
        JSON.stringify(['org-1']),
        'EX',
        60,
      );
    });
  });

  describe('assertScopeVersionFresh', () => {
    it('does not throw when token version equals server version', async () => {
      const redis = makeRedisMock({ get: jest.fn().mockResolvedValue('3') });
      const svc = new OrgScopeService(redis as never);
      await expect(svc.assertScopeVersionFresh('t', 'u', 3)).resolves.toBeUndefined();
    });

    it('does not throw when token version is greater (overshoot is fine)', async () => {
      const redis = makeRedisMock({ get: jest.fn().mockResolvedValue('3') });
      const svc = new OrgScopeService(redis as never);
      await expect(svc.assertScopeVersionFresh('t', 'u', 5)).resolves.toBeUndefined();
    });

    it('throws SCOPE_VERSION_STALE when token version is behind server', async () => {
      const redis = makeRedisMock({ get: jest.fn().mockResolvedValue('5') });
      const svc = new OrgScopeService(redis as never);
      await expect(svc.assertScopeVersionFresh('t', 'u', 3))
        .rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('SCOPE_VERSION_STALE error has the correct code', async () => {
      const redis = makeRedisMock({ get: jest.fn().mockResolvedValue('5') });
      const svc = new OrgScopeService(redis as never);
      try {
        await svc.assertScopeVersionFresh('t', 'u', 0);
      } catch (err) {
        expect((err as UnauthorizedException).getResponse()).toMatchObject({
          code: 'SCOPE_VERSION_STALE',
        });
      }
    });

    it('seeds counter at 0 on cold-start (key absent) and allows any token', async () => {
      const redis = makeRedisMock({
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
      });
      const svc = new OrgScopeService(redis as never);
      await expect(svc.assertScopeVersionFresh('t', 'u', 0)).resolves.toBeUndefined();
      expect(redis.set).toHaveBeenCalledWith('tenant:t:user:u:scope_version', '0');
    });

    it('allows through when Redis throws (fail-open)', async () => {
      const redis = makeRedisMock({
        get: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      });
      const svc = new OrgScopeService(redis as never);
      await expect(svc.assertScopeVersionFresh('t', 'u', 0)).resolves.toBeUndefined();
    });
  });

  describe('bumpScopeVersion', () => {
    it('atomically increments the counter and returns the new value', async () => {
      const redis = makeRedisMock({ incr: jest.fn().mockResolvedValue(4) });
      const svc = new OrgScopeService(redis as never);
      const v = await svc.bumpScopeVersion('t', 'u');
      expect(v).toBe(4);
      expect(redis.incr).toHaveBeenCalledWith('tenant:t:user:u:scope_version');
    });

    it('sets a 24h TTL on the counter key after increment', async () => {
      const redis = makeRedisMock({ incr: jest.fn().mockResolvedValue(2) });
      const svc = new OrgScopeService(redis as never);
      await svc.bumpScopeVersion('t', 'u');
      expect(redis.expire).toHaveBeenCalledWith('tenant:t:user:u:scope_version', 86400);
    });

    it('returns 0 sentinel when Redis throws', async () => {
      const redis = makeRedisMock({
        incr: jest.fn().mockRejectedValue(new Error('Redis down')),
      });
      const svc = new OrgScopeService(redis as never);
      const v = await svc.bumpScopeVersion('t', 'u');
      expect(v).toBe(0);
    });
  });
});
