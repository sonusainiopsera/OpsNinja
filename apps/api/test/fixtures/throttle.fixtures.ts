/**
 * Fixtures for ThrottleService unit and integration tests.
 *
 * Provides:
 *   - FakeRedis: in-memory Redis mock with INCR, GET, SET, DEL, PTTL, pipeline
 *   - FakeClock: injectable clock for deterministic TTL tests
 *   - makeThrottleConfig: factory for typed config overrides
 */

export interface FakeRedisEntry {
  value: string;
  expiresAt: number | null; // ms timestamp or null for no expiry
}

/**
 * Minimal in-memory Redis stub. Supports the operations used by ThrottleService.
 * Clock-aware: expiry is compared against injected timestamp.
 */
export class FakeRedis {
  private store = new Map<string, FakeRedisEntry>();
  private _now: () => number;

  constructor(nowFn: () => number = Date.now) {
    this._now = nowFn;
  }

  advanceTime(ms: number): void {
    const base = this._now();
    this._now = () => base + ms;
  }

  private isExpired(entry: FakeRedisEntry): boolean {
    return entry.expiresAt !== null && this._now() >= entry.expiresAt;
  }

  private get(key: string): FakeRedisEntry | undefined {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async set(key: string, value: string, exMode?: string, exVal?: number): Promise<'OK'> {
    let expiresAt: number | null = null;
    if (exMode === 'EX' && exVal !== undefined) {
      expiresAt = this._now() + exVal * 1000;
    } else if (exMode === 'PX' && exVal !== undefined) {
      expiresAt = this._now() + exVal;
    }
    const existing = this.store.get(key);
    if (exMode === 'NX' && existing && !this.isExpired(existing)) {
      return 'OK'; // NX: only set if not exists
    }
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.get(key)?.value ?? null;
  }

  async incr(key: string): Promise<number> {
    const entry = this.get(key);
    const current = entry ? parseInt(entry.value, 10) : 0;
    const next = current + 1;
    const expiresAt = entry?.expiresAt ?? null;
    this.store.set(key, { value: String(next), expiresAt });
    return next;
  }

  async expire(key: string, seconds: number, mode?: string): Promise<number> {
    const entry = this.get(key);
    if (!entry) return 0;
    if (mode === 'NX' && entry.expiresAt !== null) return 0; // NX: only set if no expiry
    entry.expiresAt = this._now() + seconds * 1000;
    return 1;
  }

  async pttl(key: string): Promise<number> {
    const entry = this.get(key);
    if (!entry) return -2; // key does not exist
    if (entry.expiresAt === null) return -1; // no expiry
    const remaining = entry.expiresAt - this._now();
    return remaining > 0 ? remaining : -2;
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
    }
    return count;
  }

  pipeline(): FakePipeline {
    return new FakePipeline(this);
  }
}

export class FakePipeline {
  private ops: Array<() => Promise<[null, unknown]>> = [];

  constructor(private readonly redis: FakeRedis) {}

  incr(key: string): this {
    this.ops.push(async () => [null, await this.redis.incr(key)]);
    return this;
  }

  expire(key: string, seconds: number, mode?: string): this {
    this.ops.push(async () => [null, await this.redis.expire(key, seconds, mode)]);
    return this;
  }

  set(key: string, value: string, exMode?: string, exVal?: number): this {
    this.ops.push(async () => [null, await this.redis.set(key, value, exMode, exVal)]);
    return this;
  }

  del(...keys: string[]): this {
    this.ops.push(async () => [null, await this.redis.del(...keys)]);
    return this;
  }

  async exec(): Promise<Array<[null, unknown]>> {
    const results: Array<[null, unknown]> = [];
    for (const op of this.ops) {
      results.push(await op());
    }
    return results;
  }
}

export function makeThrottleConfig(overrides: Partial<{
  maxFailuresPerHour: number;
  lockoutMinutes: number;
  perIpWindowSeconds: number;
  perIpLimit: number;
}> = {}) {
  return {
    maxFailuresPerHour: 5,
    lockoutMinutes: 15,
    perIpWindowSeconds: 3600,
    perIpLimit: 100,
    ...overrides,
  };
}

export const THROTTLE_TEST_EMAIL = 'test-user@example.com';
export const THROTTLE_TEST_IP = '192.0.2.1';
export const THROTTLE_TEST_TENANT_ID = 'f9000000-0000-0000-0000-000000000001';
