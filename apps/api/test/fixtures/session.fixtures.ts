/**
 * Shared test fixtures for auth / session tests.
 */

import { createHash, generateKeyPairSync, randomBytes } from 'crypto';
import { randomUUID } from 'crypto';
import { TENANT_A_ID, TENANT_B_ID } from '../factories/principal.factory';

export { TENANT_A_ID, TENANT_B_ID };

export const STAFF_USER_ID = '00000000-0000-0000-0000-100000000001';

// ── RSA keypair ──────────────────────────────────────────────────────────────

export interface TestKeyPair {
  privateKey: string;
  publicKey: string;
  kid: string;
}

/**
 * Generates a fresh 2048-bit RSA keypair.  Call once per test suite and cache.
 */
export function generateTestKeyPair(kid = 'test-key-1'): TestKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey, kid };
}

// ── Session record fixtures ──────────────────────────────────────────────────

export interface SessionFixture {
  id: string;
  tenantId: string;
  userId: string;
  familyId: string;
  rawToken: string;
  hash: string;
}

export function makeSessionFixture(overrides?: Partial<SessionFixture>): SessionFixture {
  const rawToken = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(rawToken, 'hex').digest('hex');
  return {
    id: randomUUID(),
    tenantId: TENANT_A_ID,
    userId: STAFF_USER_ID,
    familyId: randomUUID(),
    rawToken,
    hash,
    ...overrides,
  };
}

// ── Fake Redis helper ────────────────────────────────────────────────────────

/**
 * Minimal in-memory Redis stub for unit tests.
 * Implements the commands used by SessionService.
 */
export function makeFakeRedis() {
  const store = new Map<string, Map<string, string>>();
  const sets = new Map<string, Set<string>>();
  const strings = new Map<string, string>();

  const self = {
    hset: jest.fn().mockImplementation((key: string, dataOrField: unknown, value?: unknown) => {
      if (!store.has(key)) store.set(key, new Map());
      const m = store.get(key)!;
      if (typeof dataOrField === 'object' && dataOrField !== null) {
        for (const [k, v] of Object.entries(dataOrField as Record<string, string>)) {
          m.set(k, String(v));
        }
      } else if (typeof dataOrField === 'string') {
        m.set(dataOrField, String(value ?? ''));
      }
      return Promise.resolve(1);
    }),

    hmset: jest.fn().mockImplementation((key: string, data: Record<string, string>) => {
      if (!store.has(key)) store.set(key, new Map());
      const m = store.get(key)!;
      for (const [k, v] of Object.entries(data)) m.set(k, String(v));
      return Promise.resolve('OK');
    }),

    hgetall: jest.fn().mockImplementation((key: string) => {
      const m = store.get(key);
      if (!m) return Promise.resolve(null);
      const result: Record<string, string> = {};
      m.forEach((v, k) => (result[k] = v));
      return Promise.resolve(result);
    }),

    expire: jest.fn().mockResolvedValue(1),

    sadd: jest.fn().mockImplementation((key: string, ...members: string[]) => {
      if (!sets.has(key)) sets.set(key, new Set());
      members.forEach((m) => sets.get(key)!.add(m));
      return Promise.resolve(members.length);
    }),

    smembers: jest.fn().mockImplementation((key: string) =>
      Promise.resolve([...(sets.get(key) ?? [])]),
    ),

    get: jest.fn().mockImplementation((key: string) =>
      Promise.resolve(strings.get(key) ?? null),
    ),

    pipeline: jest.fn().mockImplementation(() => {
      const cmds: Array<() => void> = [];
      const pipe = {
        hset: jest.fn().mockImplementation((key: string, field: string, value: string) => {
          cmds.push(() => {
            if (!store.has(key)) store.set(key, new Map());
            store.get(key)!.set(field, value);
          });
          return pipe;
        }),
        exec: jest.fn().mockImplementation(() => {
          cmds.forEach((fn) => fn());
          return Promise.resolve([]);
        }),
      };
      return pipe;
    }),

    script: jest.fn().mockResolvedValue('fake-sha'),
    eval: jest.fn().mockResolvedValue([1, 'ROTATED', '']),
    evalsha: jest.fn().mockResolvedValue([1, 'ROTATED', '']),

    _store: store,
    _sets: sets,
    _strings: strings,
  };

  return self;
}
