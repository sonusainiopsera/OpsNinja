/**
 * Test fixtures for the identity / session subsystem.
 *
 * Committed for reuse by all stories that touch auth, token validation,
 * or session management. The signing key pair is generated once via
 * Node's built-in `crypto.generateKeyPairSync` so the suite runs offline.
 *
 * IMPORTANT: These keys are ONLY for testing. Never use them in production.
 */

import { generateKeyPairSync } from 'crypto';
import { randomUUID } from 'crypto';
import type { MintTokenInput } from '../../src/modules/identity/interfaces/token-claims.interface';
import type { CreateSessionInput } from '../../src/modules/identity/interfaces/session.interface';
import {
  TENANT_A_ID,
  TENANT_B_ID,
  TENANT_A_STAFF_USER_ID,
  TENANT_B_STAFF_USER_ID,
} from '../factories/principal-context.factory';

// ---------------------------------------------------------------------------
// Signing key pair (generated at module load, cached for the test run)
// ---------------------------------------------------------------------------

let _cachedKeyPair: { privateKeyPem: string; publicKeyPem: string } | null = null;

export function getTestSigningKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  if (!_cachedKeyPair) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    _cachedKeyPair = {
      privateKeyPem: privateKey,
      publicKeyPem: publicKey,
    };
  }
  return _cachedKeyPair;
}

export const TEST_KID = 'test-key-1';
export const TEST_ISSUER = 'https://api.test.opsninja.io';
export const TEST_AUDIENCE = 'opsninja-test';

/**
 * Environment variable overrides for TokenService in tests.
 */
export function tokenServiceTestEnv(): Record<string, string> {
  const { privateKeyPem, publicKeyPem } = getTestSigningKeyPair();
  return {
    AUTH_PRIVATE_KEY: privateKeyPem,
    AUTH_PUBLIC_KEY: publicKeyPem,
    AUTH_KID: TEST_KID,
    AUTH_ISSUER: TEST_ISSUER,
    AUTH_AUDIENCE: TEST_AUDIENCE,
  };
}

// ---------------------------------------------------------------------------
// Seeded session records for integration tests
// ---------------------------------------------------------------------------

export const SESSION_A_ID = '00000000-sess-0000-0000-000000000001';
export const SESSION_B_ID = '00000000-sess-0000-0000-000000000002';
export const FAMILY_A_ID = '00000000-fam0-0000-0000-000000000001';
export const FAMILY_B_ID = '00000000-fam0-0000-0000-000000000002';

// ---------------------------------------------------------------------------
// Mint-token input factories
// ---------------------------------------------------------------------------

export function buildMintInput(overrides?: Partial<MintTokenInput>): MintTokenInput {
  return {
    sub: TENANT_A_STAFF_USER_ID,
    tenantId: TENANT_A_ID,
    roles: ['agent'],
    orgScopeVersion: 1,
    userType: 'staff',
    ...overrides,
  };
}

export function buildMintInputTenantB(overrides?: Partial<MintTokenInput>): MintTokenInput {
  return {
    sub: TENANT_B_STAFF_USER_ID,
    tenantId: TENANT_B_ID,
    roles: ['agent'],
    orgScopeVersion: 1,
    userType: 'staff',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Session creation input factories
// ---------------------------------------------------------------------------

export function buildCreateSessionInput(
  overrides?: Partial<CreateSessionInput>,
): CreateSessionInput {
  return {
    userId: TENANT_A_STAFF_USER_ID,
    tenantId: TENANT_A_ID,
    familyId: FAMILY_A_ID,
    ipAddress: '127.0.0.1',
    userAgent: 'jest-test/1.0',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fake Redis (in-memory) for unit tests
// ---------------------------------------------------------------------------

type RedisHashStore = Map<string, Map<string, string>>;
type RedisStringStore = Map<string, { value: string; expiresAt?: number }>;

/**
 * Minimal fake Redis client suitable for SessionService unit tests.
 * Implements only the methods used by the service.
 */
export class FakeRedis {
  private hashes: RedisHashStore = new Map();
  private strings: RedisStringStore = new Map();
  private _now = Date.now();

  /** Override the current time (for grace-window tests). */
  setNow(ms: number): void {
    this._now = ms;
  }

  async hset(key: string, fields: Record<string, string>): Promise<number> {
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    const hash = this.hashes.get(key)!;
    for (const [k, v] of Object.entries(fields)) hash.set(k, v);
    return Object.keys(fields).length;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    const hash = this.hashes.get(key);
    if (!hash) return null;
    return Object.fromEntries(hash.entries());
  }

  async expireat(_key: string, _ts: number): Promise<number> {
    return 1;
  }

  async set(key: string, value: string, _ex?: string, ttlSeconds?: number): Promise<'OK'> {
    const expiresAt = ttlSeconds
      ? this._now + ttlSeconds * 1000
      : undefined;
    this.strings.set(key, { value, expiresAt });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const entry = this.strings.get(key);
    if (!entry) return null;
    if (entry.expiresAt && this._now > entry.expiresAt) {
      this.strings.delete(key);
      return null;
    }
    return entry.value;
  }

  async exists(key: string): Promise<number> {
    return this.hashes.has(key) || this.strings.has(key) ? 1 : 0;
  }

  multi() {
    // Collect operations and execute them synchronously on exec()
    const ops: Array<() => Promise<unknown>> = [];
    const builder = {
      hset: (key: string, fields: Record<string, string>) => {
        ops.push(() => this.hset(key, fields));
        return builder;
      },
      expireat: (key: string, ts: number) => {
        ops.push(() => this.expireat(key, ts));
        return builder;
      },
      exec: async () => Promise.all(ops.map((op) => op())),
    };
    return builder;
  }

  /**
   * Simple eval implementation for the rotate Lua script.
   * Re-implements the same logic in TypeScript for test fidelity.
   */
  async eval(
    _script: string,
    _numKeys: number,
    sessionKey: string,
    presentedHash: string,
    nowStr: string,
    newHash: string,
    graceExpStr: string,
    newExpMsStr: string,
  ): Promise<(string | null)[]> {
    const now = parseInt(nowStr, 10);
    const graceExp = parseInt(graceExpStr, 10);
    const newExpMs = parseInt(newExpMsStr, 10);

    const hash = this.hashes.get(sessionKey);
    if (!hash) return ['0', 'NOT_FOUND'];

    if (hash.get('revoked') === '1') return ['0', 'REVOKED'];

    const expiresAt = parseInt(hash.get('expiresAt') ?? '0', 10);
    if (now > expiresAt) return ['0', 'EXPIRED'];

    const tokenHash = hash.get('tokenHash') ?? '';
    const familyId = hash.get('familyId') ?? '';

    if (tokenHash === presentedHash) {
      const counter = parseInt(hash.get('rotationCounter') ?? '0', 10) + 1;
      hash.set('tokenHash', newHash);
      hash.set('prevHash', tokenHash);
      hash.set('prevHashExpiresAt', String(graceExp));
      hash.set('rotationCounter', String(counter));
      hash.set('expiresAt', String(newExpMs));
      return ['1', 'OK', familyId, String(counter)];
    }

    const prevHash = hash.get('prevHash') ?? '';
    const prevHashExp = parseInt(hash.get('prevHashExpiresAt') ?? '0', 10);

    if (prevHash && prevHash === presentedHash) {
      if (now <= prevHashExp) {
        return ['2', 'GRACE_WINDOW', familyId];
      } else {
        hash.set('revoked', '1');
        return ['0', 'REUSE_DETECTED', familyId];
      }
    }

    return ['0', 'INVALID'];
  }

  on(_event: string, _handler: unknown): this {
    return this;
  }
}
