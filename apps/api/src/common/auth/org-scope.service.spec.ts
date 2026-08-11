/**
 * Unit tests for OrgScopeService — cache hit, cache miss with DB fallback,
 * version bump, cold-start seeding from DB.
 */

import { OrgScopeService } from './org-scope.service';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { Test } from '@nestjs/testing';

// ---------------------------------------------------------------------------
// Fake Redis
// ---------------------------------------------------------------------------
class FakeRedis {
  private store = new Map<string, string>();
  private counters = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, ..._args: unknown[]): Promise<void> {
    this.store.set(key, value);
  }

  async incr(key: string): Promise<number> {
    const val = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, val);
    this.store.set(key, String(val));
    return val;
  }

  // Helper to seed a counter value
  seed(key: string, value: number): void {
    this.store.set(key, String(value));
    this.counters.set(key, value);
  }

  clear(): void {
    this.store.clear();
    this.counters.clear();
  }
}

// ---------------------------------------------------------------------------
// Mock global db / Drizzle
// ---------------------------------------------------------------------------

const mockRows: { organizationId?: string; scopeVersion?: number }[] = [];

// Mock the global db client used by OrgScopeService for DB fallback
jest.mock('@opsninja/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockRows),
        }),
      }),
    }),
  },
  agentOrgScopes: { organizationId: 'organizationId', scopeVersion: 'scopeVersion', tenantId: 'tenantId', userId: 'userId' },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrgScopeService', () => {
  let service: OrgScopeService;
  let fakeRedis: FakeRedis;

  beforeEach(async () => {
    fakeRedis = new FakeRedis();
    const module = await Test.createTestingModule({
      providers: [
        OrgScopeService,
        { provide: REDIS_CLIENT, useValue: fakeRedis },
      ],
    }).compile();
    service = module.get(OrgScopeService);
  });

  afterEach(() => {
    mockRows.length = 0;
    fakeRedis.clear();
  });

  describe('getScopeVersion', () => {
    it('returns cached value when key exists in Redis', async () => {
      fakeRedis.seed('tenant:t1:user:u1:scope_version', 3);
      const version = await service.getScopeVersion('t1', 'u1');
      expect(version).toBe(3);
    });

    it('falls back to DB when Redis key is absent and seeds counter', async () => {
      mockRows.push({ scopeVersion: 5 });
      const version = await service.getScopeVersion('t1', 'u1');
      expect(version).toBe(5);
    });

    it('returns 0 when user has no scope rows and Redis is empty', async () => {
      const version = await service.getScopeVersion('t1', 'u1');
      expect(version).toBe(0);
    });
  });

  describe('getScopeIds', () => {
    it('returns cached ids when key exists', async () => {
      fakeRedis.seed('tenant:t1:user:u1:scopes:v2', 0);
      await fakeRedis.set('tenant:t1:user:u1:scopes:v2', JSON.stringify(['org-a', 'org-b']));
      const ids = await service.getScopeIds('t1', 'u1', 2);
      expect(ids).toEqual(['org-a', 'org-b']);
    });

    it('falls back to DB on cache miss', async () => {
      mockRows.push({ organizationId: 'org-c' });
      const ids = await service.getScopeIds('t1', 'u1', 1);
      expect(ids).toEqual(['org-c']);
    });

    it('returns empty array when user has no scope rows', async () => {
      const ids = await service.getScopeIds('t1', 'u1', 0);
      expect(ids).toEqual([]);
    });
  });

  describe('bumpScopeVersion', () => {
    it('atomically increments the counter', async () => {
      fakeRedis.seed('tenant:t1:user:u1:scope_version', 2);
      const newVersion = await service.bumpScopeVersion('t1', 'u1');
      expect(newVersion).toBe(3);
    });

    it('starts from 1 when key does not exist', async () => {
      const newVersion = await service.bumpScopeVersion('t1', 'u1');
      expect(newVersion).toBe(1);
    });
  });
});
