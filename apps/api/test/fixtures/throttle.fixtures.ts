/**
 * Throttle test fixtures for WO-016.
 *
 * Provides a fake Redis client with injectable counter state and an injected
 * clock so throttle tests run deterministically without external dependencies.
 */

export interface FakeRedisState {
  /** key → { value, expiresAt } */
  store: Map<string, { value: string; expiresAt: number }>;
}

/**
 * Returns a fake Redis mock that tracks INCR/SET/TTL/DEL/pipeline state
 * in an in-memory map.  The mock uses a configurable "now" function so
 * tests can fast-forward time to expire keys.
 *
 * Usage:
 *   const { redis, state, advanceTime } = makeFakeRedis();
 */
export function makeFakeRedis(initialNow = 1_000_000) {
  let now = initialNow;
  const store = new Map<string, { value: string; expiresAt: number }>();

  function isAlive(key: string): boolean {
    const entry = store.get(key);
    if (!entry) return false;
    return entry.expiresAt === -1 || entry.expiresAt > now;
  }

  function getEntry(key: string): string | null {
    if (!isAlive(key)) {
      store.delete(key);
      return null;
    }
    return store.get(key)!.value;
  }

  function ttl(key: string): number {
    const entry = store.get(key);
    if (!entry || !isAlive(key)) return -2;
    if (entry.expiresAt === -1) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - now) / 1000));
  }

  const redis = {
    get: jest.fn(async (key: string) => getEntry(key)),
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      let expiresAt = -1;
      if (args[0] === 'EX' && typeof args[1] === 'number') {
        expiresAt = now + args[1] * 1000;
      }
      store.set(key, { value, expiresAt });
      return 'OK';
    }),
    incr: jest.fn(async (key: string) => {
      const existing = getEntry(key);
      const newVal = (existing !== null ? parseInt(existing, 10) : 0) + 1;
      const prev = store.get(key);
      store.set(key, { value: String(newVal), expiresAt: prev?.expiresAt ?? -1 });
      return newVal;
    }),
    expire: jest.fn(async (key: string, seconds: number) => {
      const entry = store.get(key);
      if (!entry || !isAlive(key)) return 0;
      store.set(key, { value: entry.value, expiresAt: now + seconds * 1000 });
      return 1;
    }),
    ttl: jest.fn(async (key: string) => ttl(key)),
    del: jest.fn(async (...keys: string[]) => {
      let count = 0;
      for (const k of keys) { if (store.delete(k)) count++; }
      return count;
    }),
    pipeline: jest.fn(() => {
      const ops: Array<() => Promise<unknown>> = [];
      const pipe = {
        incr: (key: string) => { ops.push(() => redis.incr(key)); return pipe; },
        ttl:  (key: string) => { ops.push(() => redis.ttl(key));  return pipe; },
        del:  (...keys: string[]) => { ops.push(() => redis.del(...keys)); return pipe; },
        set:  (key: string, value: string, ...args: unknown[]) => {
          ops.push(() => (redis.set as Function)(key, value, ...args));
          return pipe;
        },
        exec: jest.fn(async () => {
          const results: [null, unknown][] = [];
          for (const op of ops) {
            results.push([null, await op()]);
          }
          return results;
        }),
      };
      return pipe;
    }),
  };

  return {
    redis: redis as unknown as import('ioredis').default,
    state: { store } as FakeRedisState,
    /** Advance fake clock by `ms` milliseconds, expiring TTL-bound keys. */
    advanceTime: (ms: number) => { now += ms; },
    getNow: () => now,
  };
}

/** Deterministic test email addresses (no actual accounts). */
export const TEST_EMAILS = {
  user1: 'throttle-test-user1@example.invalid',
  user2: 'throttle-test-user2@example.invalid',
};

/** Deterministic test IP addresses. */
export const TEST_IPS = {
  office: '203.0.113.1',   // TEST-NET-3 (RFC 5737)
  corporate: '203.0.113.2',
  attacker: '198.51.100.1', // TEST-NET-2
};
