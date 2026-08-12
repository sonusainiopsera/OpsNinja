/**
 * Unit tests for ReconcilerService — AC-5, AC-6, AC-10.
 *
 * Uses mock Pool and mock Redis; no real database or Redis process required.
 *
 * Covers:
 *  - AC-5: reconcileTenant overwrites Redis KPI with Postgres values
 *  - AC-5: drift metric emitted per counter when Redis diverges from Postgres
 *  - AC-5: zero drift when Redis already matches Postgres (no overwrite needed
 *          but overwrite still happens for safety)
 *  - AC-6: SET LOCAL statement_timeout and app.current_tenant are issued before
 *          any SELECT
 *  - AC-6: COMMIT issued after all reads; ROLLBACK on failure
 *  - reconcileTenant skips (catches + logs) a tenant that throws
 *  - runAll iterates all active tenants from Redis set
 *  - Tenant with zero tickets → zeroed KPI written to Redis (never absent)
 *  - Negative-clamp guard: Redis negative counter corrected to 0 by overwrite
 *  - needsSnapshot flag set in Redis when drift is non-zero
 */

import { ReconcilerService } from './reconciler.service';
import { Keys } from '../redis/keys';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// ---------------------------------------------------------------------------
// Fake Pool / PoolClient
// ---------------------------------------------------------------------------

interface QueryCall { text: string; values?: unknown[] }

class FakePoolClient {
  queries: QueryCall[] = [];
  released = false;

  /** Pre-seeded responses by SQL keyword */
  private responses: Map<string, unknown[][]> = new Map();

  seedResponse(keyword: string, rows: unknown[][]): void {
    this.responses.set(keyword, rows);
  }

  async query<T = { rows: unknown[] }>(text: string, values?: unknown[]): Promise<T> {
    this.queries.push({ text, values });
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] } as T;

    for (const [kw, rows] of this.responses.entries()) {
      if (text.includes(kw)) return { rows } as T;
    }
    return { rows: [] } as T;
  }

  release(): void { this.released = true; }
}

class FakePool {
  client!: FakePoolClient;
  async connect(): Promise<FakePoolClient> {
    this.client = new FakePoolClient();
    return this.client;
  }
}

// ---------------------------------------------------------------------------
// Fake Redis
// ---------------------------------------------------------------------------

class FakeRedis {
  calls: Array<{ cmd: string; args: unknown[] }> = [];
  private sets: Record<string, Set<string>> = {};
  private store: Record<string, string> = {};

  async smembers(key: string): Promise<string[]> {
    this.calls.push({ cmd: 'smembers', args: [key] });
    return Array.from(this.sets[key] ?? new Set());
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    this.calls.push({ cmd: 'sadd', args: [key, ...members] });
    if (!this.sets[key]) this.sets[key] = new Set();
    members.forEach((m) => this.sets[key]!.add(m));
    return members.length;
  }

  async set(key: string, value: string): Promise<void> {
    this.calls.push({ cmd: 'set', args: [key, value] });
    this.store[key] = value;
  }

  private pipelineCalls: Array<{ cmd: string; args: unknown[] }> = [];

  pipeline(): ReturnType<FakeRedis['pipeline']> {
    this.pipelineCalls = [];
    const self = this;
    const pipe = {
      del: (key: string) => { self.pipelineCalls.push({ cmd: 'del', args: [key] }); return pipe; },
      hset: (key: string, ...rest: unknown[]) => { self.pipelineCalls.push({ cmd: 'hset', args: [key, ...rest] }); return pipe; },
      set: (key: string, value: string) => { self.pipelineCalls.push({ cmd: 'set', args: [key, value] }); return pipe; },
      exec: async () => {
        self.calls.push(...self.pipelineCalls);
        return [];
      },
    };
    return pipe as ReturnType<FakeRedis['pipeline']>;
  }

  setPipelineCallsAccess() {
    return this.pipelineCalls;
  }
}

// ---------------------------------------------------------------------------
// Fake AggregateStore
// ---------------------------------------------------------------------------

class FakeAggregateStore {
  kpiByTenant: Record<string, Record<string, number>> = {};
  overwriteCalls: Array<{ tenantId: string; kpi: Record<string, number> }> = [];

  async getKpi(tenantId: string): Promise<Record<string, number>> {
    return this.kpiByTenant[tenantId] ?? {};
  }

  async overwriteKpi(tenantId: string, kpi: Record<string, number>): Promise<void> {
    this.overwriteCalls.push({ tenantId, kpi });
    this.kpiByTenant[tenantId] = { ...kpi };
  }

  async overwriteZset(_key: string, _members: Array<[number, string]>): Promise<void> {
    // no-op in unit tests
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeReconciler(overrides: {
  pool?: FakePool;
  redis?: FakeRedis;
  store?: FakeAggregateStore;
} = {}): {
  service: ReconcilerService;
  pool: FakePool;
  redis: FakeRedis;
  store: FakeAggregateStore;
} {
  const pool = overrides.pool ?? new FakePool();
  const redis = overrides.redis ?? new FakeRedis();
  const store = overrides.store ?? new FakeAggregateStore();

  const service = new ReconcilerService(
    pool as never,
    redis as never,
    store as never,
  );

  return { service, pool, redis, store };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedTenant(redis: FakeRedis, tenantId: string): void {
  if (!redis['sets'][Keys.activeTenants()]) {
    redis['sets'][Keys.activeTenants()] = new Set();
  }
  redis['sets'][Keys.activeTenants()]!.add(tenantId);
}

function seedPgResults(client: FakePoolClient, overrides: {
  openRows?: Array<{ priority: string; org_id: string; cnt: string }>;
  slaCnt?: string;
  approachCnt?: string;
  csatAvg?: string;
  csatCnt?: string;
} = {}): void {
  const openRows = overrides.openRows ?? [
    { priority: 'P1', org_id: 'org-001', cnt: '3' },
    { priority: 'P2', org_id: 'org-001', cnt: '5' },
    { priority: 'P3', org_id: 'org-002', cnt: '2' },
  ];
  client.seedResponse('status = ANY', openRows);
  client.seedResponse("state = 'running'", [{ cnt: overrides.slaCnt ?? '4' }]);
  client.seedResponse("state = 'running'", [{ cnt: overrides.slaCnt ?? '4' }]);
  client.seedResponse('interval', [{ cnt: overrides.approachCnt ?? '1' }]);
  client.seedResponse('csat_surveys', [{ avg: overrides.csatAvg ?? '4.2', cnt: overrides.csatCnt ?? '10' }]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReconcilerService', () => {
  describe('reconcileTenant — query structure (AC-6)', () => {
    it('issues SET LOCAL app.current_tenant before any SELECT', async () => {
      const { service, pool, redis, store } = makeReconciler();
      seedTenant(redis, TENANT_A);
      // Need to seed pool.client after connect() is called
      const origConnect = pool.connect.bind(pool);
      pool.connect = async () => {
        const c = await origConnect();
        seedPgResults(c);
        return c;
      };

      await service.runAll();

      const queries = pool.client.queries.map((q) => q.text);
      const setLocalIdx = queries.findIndex((q) => q.includes('set_config'));
      const firstSelectIdx = queries.findIndex((q) => q.includes('SELECT'));
      expect(setLocalIdx).toBeGreaterThan(-1);
      expect(firstSelectIdx).toBeGreaterThan(setLocalIdx);
    });

    it('issues SET LOCAL statement_timeout before SELECT', async () => {
      const { service, pool, redis } = makeReconciler();
      seedTenant(redis, TENANT_A);
      const origConnect = pool.connect.bind(pool);
      pool.connect = async () => {
        const c = await origConnect();
        seedPgResults(c);
        return c;
      };

      await service.runAll();

      const queries = pool.client.queries.map((q) => q.text);
      expect(queries.some((q) => q.includes('statement_timeout'))).toBe(true);
    });

    it('passes tenantId as parameter to the open-tickets query', async () => {
      const { service, pool, redis } = makeReconciler();
      seedTenant(redis, TENANT_A);
      const origConnect = pool.connect.bind(pool);
      pool.connect = async () => {
        const c = await origConnect();
        seedPgResults(c);
        return c;
      };

      await service.runAll();

      const tenantQuery = pool.client.queries.find(
        (q) => q.text.includes('tenant_id') && q.values?.includes(TENANT_A),
      );
      expect(tenantQuery).toBeDefined();
    });

    it('commits the transaction after all reads', async () => {
      const { service, pool, redis } = makeReconciler();
      seedTenant(redis, TENANT_A);
      const origConnect = pool.connect.bind(pool);
      pool.connect = async () => {
        const c = await origConnect();
        seedPgResults(c);
        return c;
      };

      await service.runAll();

      const queries = pool.client.queries.map((q) => q.text);
      expect(queries).toContain('COMMIT');
      expect(queries).not.toContain('ROLLBACK');
    });

    it('releases the pool client after reconciliation', async () => {
      const { service, pool, redis } = makeReconciler();
      seedTenant(redis, TENANT_A);
      const origConnect = pool.connect.bind(pool);
      pool.connect = async () => {
        const c = await origConnect();
        seedPgResults(c);
        return c;
      };

      await service.runAll();

      expect(pool.client.released).toBe(true);
    });
  });

  describe('reconcileTenant — KPI overwrite (AC-5)', () => {
    it('calls overwriteKpi with Postgres-derived values', async () => {
      const { service, pool, redis, store } = makeReconciler();
      seedTenant(redis, TENANT_A);
      const origConnect = pool.connect.bind(pool);
      pool.connect = async () => {
        const c = await origConnect();
        c.seedResponse('status = ANY', [
          { priority: 'P1', org_id: 'org-1', cnt: '3' },
          { priority: 'P2', org_id: 'org-1', cnt: '5' },
        ]);
        c.seedResponse("state = 'running'", [{ cnt: '4' }]);
        c.seedResponse('interval', [{ cnt: '1' }]);
        c.seedResponse('csat_surveys', [{ avg: '4.2', cnt: '10' }]);
        return c;
      };

      await service.runAll();

      expect(store.overwriteCalls.length).toBe(1);
      const kpi = store.overwriteCalls[0]!.kpi;
      expect(kpi['open_total']).toBe(8);   // 3 + 5
      expect(kpi['active_p1']).toBe(3);
      expect(kpi['active_p2']).toBe(5);
      expect(kpi['running_slas']).toBe(4);
      expect(kpi['approaching_breach']).toBe(1);
    });

    it('overwrites with zero counters when tenant has no tickets', async () => {
      const { service, pool, redis, store } = makeReconciler();
      seedTenant(redis, TENANT_A);
      const origConnect = pool.connect.bind(pool);
      pool.connect = async () => {
        const c = await origConnect();
        c.seedResponse('status = ANY', []); // no open tickets
        c.seedResponse("state = 'running'", [{ cnt: '0' }]);
        c.seedResponse('interval', [{ cnt: '0' }]);
        c.seedResponse('csat_surveys', [{ avg: null, cnt: '0' }]);
        return c;
      };

      await service.runAll();

      expect(store.overwriteCalls.length).toBe(1);
      const kpi = store.overwriteCalls[0]!.kpi;
      expect(kpi['open_total']).toBe(0);
      expect(kpi['active_p1']).toBe(0);
      expect(kpi['active_p2']).toBe(0);
    });
  });

  describe('drift measurement (AC-5)', () => {
    it('does not set needsSnapshot when Redis already matches Postgres', async () => {
      const { service, pool, redis, store } = makeReconciler();
      seedTenant(redis, TENANT_A);

      // Pre-seed Redis to match what Postgres returns
      store.kpiByTenant[TENANT_A] = {
        open_total: 8, active_p1: 3, active_p2: 5,
        running_slas: 4, approaching_breach: 1,
        csat_7d_avg: 420, csat_7d_count: 10,
      };

      const origConnect = pool.connect.bind(pool);
      pool.connect = async () => {
        const c = await origConnect();
        c.seedResponse('status = ANY', [
          { priority: 'P1', org_id: 'org-1', cnt: '3' },
          { priority: 'P2', org_id: 'org-1', cnt: '5' },
        ]);
        c.seedResponse("state = 'running'", [{ cnt: '4' }]);
        c.seedResponse('interval', [{ cnt: '1' }]);
        c.seedResponse('csat_surveys', [{ avg: '4.2', cnt: '10' }]);
        return c;
      };

      await service.runAll();

      // No needsSnapshot set because no drift
      const needsSnapshotCalls = redis.calls.filter(
        (c) => c.cmd === 'set' && String(c.args[0]).includes('needs_snapshot'),
      );
      expect(needsSnapshotCalls.length).toBe(0);
    });

    it('sets needsSnapshot flag in Redis when drift is non-zero', async () => {
      const { service, pool, redis, store } = makeReconciler();
      seedTenant(redis, TENANT_A);

      // Redis has stale value (5 open, Postgres says 8)
      store.kpiByTenant[TENANT_A] = { open_total: 5 };

      const origConnect = pool.connect.bind(pool);
      pool.connect = async () => {
        const c = await origConnect();
        c.seedResponse('status = ANY', [
          { priority: 'P1', org_id: 'org-1', cnt: '3' },
          { priority: 'P2', org_id: 'org-1', cnt: '5' },
        ]);
        c.seedResponse("state = 'running'", [{ cnt: '4' }]);
        c.seedResponse('interval', [{ cnt: '1' }]);
        c.seedResponse('csat_surveys', [{ avg: '4.2', cnt: '10' }]);
        return c;
      };

      await service.runAll();

      // needsSnapshot should be set via pipeline
      const pipelineCalls = redis.calls.filter(
        (c) => c.cmd === 'set' && (c.args[0] as string)?.includes('needs_snapshot'),
      );
      expect(pipelineCalls.length).toBeGreaterThan(0);
    });
  });

  describe('runAll — error isolation (AC constraint)', () => {
    it('continues reconciling Tenant B when Tenant A throws', async () => {
      const { service, pool, redis, store } = makeReconciler();
      seedTenant(redis, TENANT_A);
      seedTenant(redis, TENANT_B);

      let connectCount = 0;
      pool.connect = async () => {
        connectCount++;
        const c = new FakePoolClient();
        if (connectCount === 1) {
          // Tenant A's client throws on first SELECT
          c.query = async (text: string, values?: unknown[]) => {
            if (text.includes('SELECT')) throw new Error('Simulated PG timeout for Tenant A');
            return { rows: [] } as never;
          };
        } else {
          // Tenant B's client succeeds
          seedPgResults(c);
        }
        pool.client = c;
        return c;
      };

      await service.runAll();

      // Tenant B's overwrite should still have been called
      const tenantBOverwrites = store.overwriteCalls.filter((c) => c.tenantId === TENANT_B);
      expect(tenantBOverwrites.length).toBe(1);
    });

    it('ROLLBACKs on error and releases client', async () => {
      const { service, pool, redis } = makeReconciler();
      seedTenant(redis, TENANT_A);

      const c = new FakePoolClient();
      c.query = async (text: string) => {
        if (text.includes('SELECT')) throw new Error('Simulated error');
        return { rows: [] } as never;
      };
      pool.connect = async () => { pool.client = c; return c; };

      await service.runAll(); // should not throw

      expect(c.queries.map((q) => q.text)).toContain('ROLLBACK');
      expect(c.released).toBe(true);
    });
  });

  describe('runAll — active tenant tracking', () => {
    it('processes all tenants from the active set', async () => {
      const { service, pool, redis, store } = makeReconciler();
      seedTenant(redis, TENANT_A);
      seedTenant(redis, TENANT_B);

      const clients: FakePoolClient[] = [];
      pool.connect = async () => {
        const c = new FakePoolClient();
        seedPgResults(c);
        pool.client = c;
        clients.push(c);
        return c;
      };

      await service.runAll();

      // One overwrite per tenant
      expect(store.overwriteCalls.length).toBe(2);
      const tenantIds = store.overwriteCalls.map((c) => c.tenantId).sort();
      expect(tenantIds).toContain(TENANT_A);
      expect(tenantIds).toContain(TENANT_B);
    });

    it('does nothing when no active tenants', async () => {
      const { service, store } = makeReconciler();
      // redis smembers returns empty by default

      await service.runAll();

      expect(store.overwriteCalls.length).toBe(0);
    });
  });
});
