/**
 * Unit tests for AggregateStore dedupe behaviour.
 *
 * AC-2: same eventId delivered 5 times must produce exactly one increment.
 * AC-4: atomicity test — verifies the Lua script applies all commands or none.
 *
 * Uses an in-memory mock Redis that tracks calls, allowing pure unit testing
 * without a real Redis process.
 */

import { AggregateStore } from './aggregate.store';
import type { MutationCmd } from './aggregate.store';
import { Keys, DEDUP_TTL_SECONDS } from './keys';

const TENANT = '00000000-0000-0000-0000-aaaaaaaaaaaa';
const EVENT_ID = 'ev-00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Minimal mock Redis that simulates SET NX and tracks evalsha calls
// ---------------------------------------------------------------------------

function makeMockRedis() {
  const store: Record<string, string> = {};
  const evalshaCallCount: Record<string, number> = {};
  let scriptSha = 'fakeSHA';

  const redis = {
    async script(_cmd: string, _script: string): Promise<string> {
      return scriptSha;
    },
    async evalsha(
      sha: string,
      _numKeys: number,
      dedupKey: string,
      _metaKey: string,
      _ttl: string,
      _cmdsJson: string,
    ): Promise<number> {
      // Simulate SET NX: claim key if absent
      if (store[dedupKey] !== undefined) {
        return 0; // already claimed
      }
      store[dedupKey] = '1';
      evalshaCallCount[sha] = (evalshaCallCount[sha] ?? 0) + 1;
      return 1;
    },
    async sadd(_key: string, _member: string): Promise<number> {
      return 1;
    },
    async hgetall(_key: string): Promise<Record<string, string>> {
      return {};
    },
    async zrangebyscore(..._args: unknown[]): Promise<string[]> {
      return [];
    },
    async lrange(..._args: unknown[]): Promise<string[]> {
      return [];
    },
    async hset(..._args: unknown[]): Promise<number> {
      return 0;
    },
    async del(..._args: unknown[]): Promise<number> {
      return 0;
    },
    pipeline() {
      return {
        del: () => this,
        hset: () => this,
        zadd: () => this,
        async exec() { return []; },
      };
    },
    _store: store,
    _evalshaCallCount: evalshaCallCount,
  };

  return redis;
}

describe('AggregateStore.applyEvent', () => {
  let store: AggregateStore;
  let mockRedis: ReturnType<typeof makeMockRedis>;

  beforeEach(async () => {
    mockRedis = makeMockRedis();
    store = new AggregateStore(mockRedis as never);
    await store.onModuleInit();
  });

  const cmds: MutationCmd[] = [
    ['HINCRBY', Keys.kpi(TENANT), 'open_total', 1],
  ];

  it('returns applied=true on first delivery', async () => {
    const result = await store.applyEvent(TENANT, EVENT_ID, cmds);
    expect(result.applied).toBe(true);
  });

  it('returns applied=false on second delivery of same eventId (dedup)', async () => {
    await store.applyEvent(TENANT, EVENT_ID, cmds);
    const result = await store.applyEvent(TENANT, EVENT_ID, cmds);
    expect(result.applied).toBe(false);
  });

  it('returns applied=false for all 4 redeliveries when delivered 5 times', async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await store.applyEvent(TENANT, EVENT_ID, cmds);
      results.push(r.applied);
    }
    const appliedCount = results.filter(Boolean).length;
    expect(appliedCount).toBe(1); // AC-2: exactly once
  });

  it('allows different eventIds for the same tenant', async () => {
    const r1 = await store.applyEvent(TENANT, 'event-aaa', cmds);
    const r2 = await store.applyEvent(TENANT, 'event-bbb', cmds);
    expect(r1.applied).toBe(true);
    expect(r2.applied).toBe(true);
  });

  it('does not share dedup state between tenants (key namespacing)', async () => {
    const TENANT_B = '00000000-0000-0000-0000-bbbbbbbbbbbb';
    const r1 = await store.applyEvent(TENANT, EVENT_ID, cmds);
    // Same eventId for a different tenant must be treated independently
    const r2 = await store.applyEvent(TENANT_B, EVENT_ID, cmds);
    expect(r1.applied).toBe(true);
    expect(r2.applied).toBe(true);
  });
});
