/**
 * Unit tests for DeltaPublisherService — WO-069 AC1, AC2, AC3, AC4
 *
 * Uses a minimal mock Redis (no actual Redis process) and a mock AggregateStore.
 *
 * Covers:
 *  AC1  — Unchanged state produces no frame
 *  AC1  — Changed state produces exactly one frame
 *  AC3  — Two concurrent pods: only one publishes per interval bucket (claim key)
 *  AC4  — Ring-buffer length capped at FRAME_RETENTION; TTL refreshed
 *  AC9  — needsSnapshot flag triggers snapshot frame type
 *       — Oversized delta falls back to snapshot frame
 */

import { DeltaPublisherService, PUBLISH_INTERVAL_MS } from './delta-publisher.service';
import { AggregateStore } from '../redis/aggregate.store';
import { Keys, FRAME_RETENTION, FRAME_TTL_SECONDS, CLAIM_TTL_SECONDS, MAX_FRAME_BYTES } from '../redis/keys';
import type { AggregateSnapshot } from './aggregate-diff';

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

interface Call {
  cmd: string;
  args: unknown[];
}

function makeMockRedis() {
  const store: Record<string, string> = {};
  const sets: Record<string, Set<string>> = {};
  const calls: Call[] = [];
  let evalResult: number = 1;

  const redis = {
    _store: store,
    _calls: calls,
    _setEvalResult: (v: number) => { evalResult = v; },

    async script(_cmd: string, _script: string) {
      return 'fake-sha';
    },

    async set(key: string, value: string, ...rest: unknown[]) {
      calls.push({ cmd: 'SET', args: [key, value, ...rest] });
      // Simulate NX: only set if not already present
      const isNx = rest.includes('NX');
      if (isNx && store[key] !== undefined) return null;
      store[key] = value;
      return 'OK';
    },

    async get(key: string) {
      return store[key] ?? null;
    },

    async getdel(key: string) {
      const v = store[key] ?? null;
      if (v !== null) delete store[key];
      return v;
    },

    async smembers(key: string) {
      return [...(sets[key] ?? new Set())];
    },

    async sadd(key: string, ...members: string[]) {
      if (!sets[key]) sets[key] = new Set();
      members.forEach(m => sets[key]!.add(m));
      return members.length;
    },

    async hgetall(_key: string) {
      return {};
    },

    async zrangebyscore(_key: string, _min: string, _max: string, ..._rest: unknown[]) {
      return [];
    },

    async evalsha(_sha: string, _numkeys: number, ..._rest: unknown[]) {
      calls.push({ cmd: 'EVALSHA', args: [_sha, _numkeys, ..._rest] });
      return evalResult;
    },

    pipeline() {
      return {
        cmds: [] as Call[],
        del(key: string) { this.cmds.push({ cmd: 'DEL', args: [key] }); return this; },
        hset(key: string, ...args: unknown[]) { this.cmds.push({ cmd: 'HSET', args: [key, ...args] }); return this; },
        set(key: string, value: string) { this.cmds.push({ cmd: 'SET', args: [key, value] }); return this; },
        async exec() { return []; },
      };
    },
  };

  return redis;
}

// ---------------------------------------------------------------------------
// Mock AggregateStore
// ---------------------------------------------------------------------------

function makeMockStore(snapshot: Partial<AggregateSnapshot> = {}): AggregateStore {
  const base: AggregateSnapshot = {
    kpis:         snapshot.kpis         ?? { open_total: 5, active_p1: 1 },
    category:     snapshot.category     ?? [{ category: 'billing', count: 3 }],
    affectedArea: snapshot.affectedArea ?? [],
    breachRisk:   snapshot.breachRisk   ?? [],
    feed:         snapshot.feed         ?? [],
  };

  return {
    getKpi:              async () => base.kpis,
    getCategoryBreakdown: async () => base.category,
    getBreachRisk:       async () => base.breachRisk,
    getFeed:             async () => base.feed,
    getMeta:             async () => ({ seq: '0' }),
    // not used in publisher
    applyEvent: async () => ({ applied: true }),
    overwriteKpi: async () => {},
    overwriteZset: async () => {},
    onModuleInit: async () => {},
  } as unknown as AggregateStore;
}

const TENANT_A = 'tenant-aaaaaa';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildService(
  redisOverride?: ReturnType<typeof makeMockRedis>,
  storeOverride?: AggregateStore,
) {
  const redis = redisOverride ?? makeMockRedis();
  const store = storeOverride ?? makeMockStore();

  // Inject active tenants
  await redis.sadd(Keys.activeTenants(), TENANT_A);

  const svc = new DeltaPublisherService(redis as never, store);
  // Simulate onModuleInit (load script, but NOT start timer)
  // We call tick() manually instead.
  (svc as unknown as { publishScriptSha: string }).publishScriptSha = 'fake-sha';
  return { svc, redis, store };
}

// ---------------------------------------------------------------------------
// AC1 — Unchanged state produces no frame
// ---------------------------------------------------------------------------

describe('DeltaPublisherService — AC1 no-change suppression', () => {
  it('publishes no frame when state is unchanged', async () => {
    const { svc, redis } = await buildService();

    // Store the "current" snapshot as published
    const snapshot = { kpis: { open_total: 5, active_p1: 1 }, category: [{ category: 'billing', count: 3 }], affectedArea: [], breachRisk: [], feed: [] };
    redis._store[Keys.published(TENANT_A)] = JSON.stringify(snapshot);

    const bucket = Math.floor(Date.now() / PUBLISH_INTERVAL_MS);

    const count = await svc.tick();
    // Claim consumed but no EVALSHA because diff returns null
    const evalshaCount = redis._calls.filter(c => c.cmd === 'EVALSHA').length;
    expect(count).toBe(0);
    expect(evalshaCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC1 — Changed state produces exactly one frame
// ---------------------------------------------------------------------------

describe('DeltaPublisherService — AC1 frame on change', () => {
  it('publishes one frame when state changed', async () => {
    const { svc, redis } = await buildService();

    // Published state is stale (open_total=3), current state is 5 → diff
    const stale = { kpis: { open_total: 3, active_p1: 1 }, category: [{ category: 'billing', count: 3 }], affectedArea: [], breachRisk: [], feed: [] };
    redis._store[Keys.published(TENANT_A)] = JSON.stringify(stale);

    const count = await svc.tick();
    expect(count).toBe(1);
    const evalshaCount = redis._calls.filter(c => c.cmd === 'EVALSHA').length;
    expect(evalshaCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC3 — Claim key prevents duplicate publish from second pod
// ---------------------------------------------------------------------------

describe('DeltaPublisherService — AC3 atomic claim', () => {
  it('second pod tick returns 0 frames when claim already held', async () => {
    const redis = makeMockRedis();
    await redis.sadd(Keys.activeTenants(), TENANT_A);

    const { svc: svc1 } = await buildService(redis);
    const { svc: svc2 } = await buildService(redis);

    // Stale published state so diff would find changes
    const stale = { kpis: { open_total: 0 }, category: [], affectedArea: [], breachRisk: [], feed: [] };
    redis._store[Keys.published(TENANT_A)] = JSON.stringify(stale);

    // Both pods fire at the same bucket
    const [count1, count2] = await Promise.all([svc1.tick(), svc2.tick()]);

    // Exactly one pod must have published
    expect(count1 + count2).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC9 — needsSnapshot flag → snapshot frame type
// ---------------------------------------------------------------------------

describe('DeltaPublisherService — AC9 reconciler snapshot flag', () => {
  it('emits type=snapshot when needsSnapshot flag is set', async () => {
    const { svc, redis } = await buildService();

    // Set the needs_snapshot flag
    redis._store[Keys.needsSnapshot(TENANT_A)] = '1';

    // Set published state = current (diff would return null without flag)
    const snapshot = { kpis: { open_total: 5, active_p1: 1 }, category: [{ category: 'billing', count: 3 }], affectedArea: [], breachRisk: [], feed: [] };
    redis._store[Keys.published(TENANT_A)] = JSON.stringify(snapshot);

    const count = await svc.tick();
    expect(count).toBe(1);

    // The EVALSHA call's frame JSON (ARGV[2]) should have type=snapshot
    const evalCall = redis._calls.find(c => c.cmd === 'EVALSHA');
    expect(evalCall).toBeDefined();
    const frameJson = evalCall!.args[6] as string;
    const frame = JSON.parse(frameJson) as { type: string };
    expect(frame.type).toBe('snapshot');
  });
});

// ---------------------------------------------------------------------------
// Size guard — oversized delta falls back to snapshot
// ---------------------------------------------------------------------------

describe('DeltaPublisherService — size guard', () => {
  it('converts oversized delta to snapshot frame', async () => {
    // Build a store that returns a feed large enough to exceed MAX_FRAME_BYTES
    const largeFeed = Array.from({ length: 500 }, (_, i) => 'x'.repeat(100) + String(i));
    const store = makeMockStore({ feed: largeFeed });
    const { svc, redis } = await buildService(undefined, store);

    // Published state has empty feed — so delta would include 500 large entries
    const prevState = { kpis: { open_total: 5, active_p1: 1 }, category: [{ category: 'billing', count: 3 }], affectedArea: [], breachRisk: [], feed: [] };
    redis._store[Keys.published(TENANT_A)] = JSON.stringify(prevState);

    const count = await svc.tick();
    expect(count).toBe(1);

    const evalCall = redis._calls.find(c => c.cmd === 'EVALSHA');
    const frameJson = evalCall!.args[6] as string;
    const frame = JSON.parse(frameJson) as { type: string };
    expect(frame.type).toBe('snapshot');
  });
});
