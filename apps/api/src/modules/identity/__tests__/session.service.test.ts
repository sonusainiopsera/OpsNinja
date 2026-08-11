/**
 * SessionService unit tests.
 *
 * Tests the rotation logic, reuse detection, revocation, and throttle
 * store using an in-memory database substitute (no real Postgres needed).
 *
 * Since SessionService uses raw SQL, we create a minimal sql mock that
 * stores rows in-memory and returns them for relevant queries.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SessionService,
  hashToken,
  hashField,
  SessionReuseError,
} from '../session.service.js';
import { InMemoryThrottleStore } from '../auth.controller.js';

// ---------------------------------------------------------------------------
// Minimal in-memory SQL mock
// ---------------------------------------------------------------------------

interface MockSession {
  tenant_id: string;
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  issued_at: string;
  expires_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
  user_agent_hash: string | null;
  ip_hash: string | null;
}

/**
 * Creates a minimal mock Sql client that stores sessions in memory.
 * Only supports the queries issued by SessionService.
 */
function createMockSql(store: MockSession[] = []) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    void strings; void values;
    return [];
  };

  sql.unsafe = async (query: string, params: unknown[] = []) => {
    const q = query.trim().toUpperCase();

    if (q.startsWith('INSERT INTO REFRESH_SESSIONS')) {
      const [tenantId, id, userId, familyId, tokenHash, issuedAt, expiresAt, userAgentHash, ipHash] = params as string[];
      store.push({
        tenant_id:       tenantId!,
        id:              id!,
        user_id:         userId!,
        family_id:       familyId!,
        token_hash:      tokenHash!,
        issued_at:       issuedAt!,
        expires_at:      expiresAt!,
        rotated_at:      null,
        revoked_at:      null,
        user_agent_hash: (userAgentHash as string | null) ?? null,
        ip_hash:         (ipHash as string | null) ?? null,
      });
      return { count: 1 };
    }

    if (q.startsWith('SELECT') && q.includes('REFRESH_SESSIONS') && q.includes('FOR UPDATE')) {
      const [tokenHash] = params as string[];
      const row = store.find((s) => s.token_hash === tokenHash);
      return row ? [row] : [];
    }

    if (q.startsWith('SELECT') && q.includes('REFRESH_SESSIONS') && q.includes('TOKEN_HASH')) {
      const [tokenHash] = params as string[];
      const row = store.find((s) => s.token_hash === tokenHash);
      return row ? [row] : [];
    }

    if (q.startsWith('UPDATE REFRESH_SESSIONS') && q.includes('ROTATED_AT')) {
      const [rotatedAt, _tenantId, id] = params as string[];
      const row = store.find((s) => s.id === id);
      if (row) row.rotated_at = rotatedAt ?? null;
      return { count: 1 };
    }

    if (q.startsWith('UPDATE REFRESH_SESSIONS') && q.includes('REVOKED_AT') && q.includes('FAMILY_ID')) {
      const [revokedAt, tenantId, familyId] = params as string[];
      let count = 0;
      for (const s of store) {
        if (s.tenant_id === tenantId && s.family_id === familyId && !s.revoked_at) {
          s.revoked_at = revokedAt ?? null;
          count++;
        }
      }
      return { count };
    }

    if (q.startsWith('UPDATE REFRESH_SESSIONS') && q.includes('REVOKED_AT') && q.includes('USER_ID')) {
      const [revokedAt, tenantId, userId] = params as string[];
      let count = 0;
      for (const s of store) {
        if (s.tenant_id === tenantId && s.user_id === userId && !s.revoked_at) {
          s.revoked_at = revokedAt ?? null;
          count++;
        }
      }
      return { count };
    }

    if (q.startsWith('UPDATE REFRESH_SESSIONS') && q.includes('REVOKED_AT')) {
      const [revokedAt, tenantId, id] = params as string[];
      const row = store.find((s) => s.id === id && s.tenant_id === tenantId);
      if (row && !row.revoked_at) { row.revoked_at = revokedAt ?? null; return { count: 1 }; }
      return { count: 0 };
    }

    if (q.startsWith('SELECT') && q.includes('COUNT')) {
      const [tenantId, userId, nowStr] = params as string[];
      const now = new Date(nowStr!);
      const n = store.filter((s) =>
        s.tenant_id === tenantId &&
        s.user_id   === userId &&
        !s.revoked_at &&
        !s.rotated_at &&
        new Date(s.expires_at) > now,
      ).length;
      return [{ n: String(n) }];
    }

    return [];
  };

  sql.begin = async (fn: (tx: unknown) => Promise<unknown>) => fn(sql);

  return sql as unknown as import('postgres').Sql;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER   = 'bbbbbbbb-0000-0000-0000-000000000001';

function makeExpiresAt(offsetMs = 8 * 60 * 60 * 1000): Date {
  return new Date(Date.now() + offsetMs);
}

// ---------------------------------------------------------------------------
// hashToken
// ---------------------------------------------------------------------------

describe('hashToken', () => {
  it('produces a 64-char hex string', () => {
    const h = hashToken('some-raw-token');
    expect(h).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });

  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('differs for different inputs', () => {
    expect(hashToken('abc')).not.toBe(hashToken('def'));
  });
});

// ---------------------------------------------------------------------------
// hashField (for IP / UA hashing)
// ---------------------------------------------------------------------------

describe('hashField', () => {
  it('produces a 64-char hex string', () => {
    expect(hashField('192.168.1.1')).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// SessionService.create
// ---------------------------------------------------------------------------

describe('SessionService.create', () => {
  it('creates a session and returns a raw token', async () => {
    const store: MockSession[] = [];
    const sql = createMockSql(store);
    const svc = new SessionService();

    const result = await svc.create(sql, {
      tenantId: TENANT,
      userId: USER,
      expiresAt: makeExpiresAt(),
    });

    expect(result.rawToken.length).toBeGreaterThan(0);
    expect(result.tokenHash).toBe(hashToken(result.rawToken));
    expect(store).toHaveLength(1);
    expect(store[0]!.token_hash).toBe(result.tokenHash);
    expect(store[0]!.family_id).toBe(result.familyId);
    expect(store[0]!.revoked_at).toBeNull();
    expect(store[0]!.rotated_at).toBeNull();
  });

  it('uses the provided familyId when continuing an existing family', async () => {
    const store: MockSession[] = [];
    const sql = createMockSql(store);
    const svc = new SessionService();

    const familyId = 'cafecafe-0000-4000-8000-000000000001';
    const result = await svc.create(sql, {
      tenantId: TENANT,
      userId: USER,
      expiresAt: makeExpiresAt(),
      familyId,
    });

    expect(result.familyId).toBe(familyId);
    expect(store[0]!.family_id).toBe(familyId);
  });
});

// ---------------------------------------------------------------------------
// SessionService.rotate — normal path
// ---------------------------------------------------------------------------

describe('SessionService.rotate — normal rotation', () => {
  it('marks old session rotated and creates new session', async () => {
    const store: MockSession[] = [];
    const sql = createMockSql(store);
    const svc = new SessionService();

    // Create initial session
    const initial = await svc.create(sql, {
      tenantId: TENANT,
      userId: USER,
      expiresAt: makeExpiresAt(),
    });

    // Rotate
    const outcome = await svc.rotate(sql, initial.rawToken, makeExpiresAt(9 * 60 * 60 * 1000));
    expect(outcome.kind).toBe('rotated');
    if (outcome.kind !== 'rotated') throw new Error('Narrowing');

    const { newSession, revokedSessionId } = outcome.result;
    expect(revokedSessionId).toBe(initial.sessionId);
    expect(newSession.familyId).toBe(initial.familyId);
    expect(newSession.rawToken).not.toBe(initial.rawToken);
    expect(store).toHaveLength(2);

    const old = store.find((s) => s.id === initial.sessionId)!;
    expect(old.rotated_at).not.toBeNull();
    const newRow = store.find((s) => s.id === newSession.sessionId)!;
    expect(newRow.rotated_at).toBeNull();
    expect(newRow.revoked_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SessionService.rotate — reuse detection
// ---------------------------------------------------------------------------

describe('SessionService.rotate — reuse detection', () => {
  it('detects reuse of an already-rotated token and revokes the family', async () => {
    const store: MockSession[] = [];
    const sql = createMockSql(store);
    const svc = new SessionService();

    // Create and rotate once
    const initial = await svc.create(sql, {
      tenantId: TENANT,
      userId: USER,
      expiresAt: makeExpiresAt(),
    });
    const firstRotation = await svc.rotate(sql, initial.rawToken, makeExpiresAt());
    expect(firstRotation.kind).toBe('rotated');

    // Present the original (now rotated) token again — reuse detected
    const reuseOutcome = await svc.rotate(sql, initial.rawToken, makeExpiresAt());
    expect(reuseOutcome.kind).toBe('reuse_detected');
    if (reuseOutcome.kind !== 'reuse_detected') throw new Error('Narrowing');
    expect(reuseOutcome.familyId).toBe(initial.familyId);

    // All sessions in the family must be revoked
    const family = store.filter((s) => s.family_id === initial.familyId);
    expect(family.every((s) => s.revoked_at !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SessionService.rotate — expired / not found
// ---------------------------------------------------------------------------

describe('SessionService.rotate — terminal states', () => {
  it('returns not_found for an unknown token', async () => {
    const sql = createMockSql([]);
    const svc = new SessionService();
    const outcome = await svc.rotate(sql, 'unknown-raw-token', makeExpiresAt());
    expect(outcome.kind).toBe('not_found');
  });

  it('returns expired for an expired token', async () => {
    const store: MockSession[] = [];
    const sql = createMockSql(store);
    const svc = new SessionService({ clock: () => new Date('2025-01-01T12:00:00Z') });

    const initial = await svc.create(sql, {
      tenantId: TENANT,
      userId: USER,
      expiresAt: new Date('2025-01-01T11:00:00Z'), // already expired
    });

    const outcome = await svc.rotate(sql, initial.rawToken, makeExpiresAt());
    expect(outcome.kind).toBe('expired');
  });
});

// ---------------------------------------------------------------------------
// SessionService.revokeAllForUser
// ---------------------------------------------------------------------------

describe('SessionService.revokeAllForUser', () => {
  it('revokes all active sessions for a user', async () => {
    const store: MockSession[] = [];
    const sql = createMockSql(store);
    const svc = new SessionService();

    // Create two sessions
    await svc.create(sql, { tenantId: TENANT, userId: USER, expiresAt: makeExpiresAt() });
    await svc.create(sql, { tenantId: TENANT, userId: USER, expiresAt: makeExpiresAt() });

    const count = await svc.revokeAllForUser(sql, TENANT, USER);
    expect(count).toBe(2);
    expect(store.every((s) => s.revoked_at !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// InMemoryThrottleStore
// ---------------------------------------------------------------------------

describe('InMemoryThrottleStore', () => {
  it('increments counter and returns correct count', async () => {
    const store = new InMemoryThrottleStore();
    expect(await store.increment('key1', 60)).toBe(1);
    expect(await store.increment('key1', 60)).toBe(2);
    expect(await store.increment('key1', 60)).toBe(3);
  });

  it('resets counter after window expiry', async () => {
    const store = new InMemoryThrottleStore();
    // Simulate by using a 0-second window (already expired on next call)
    await store.increment('key2', 0);
    // The counter should be treated as expired on next call
    const count = await store.increment('key2', 60);
    expect(count).toBe(1);
  });

  it('sets and checks lockout', async () => {
    const store = new InMemoryThrottleStore();
    expect(await store.isLockedOut('user@example.com')).toBe(false);
    await store.setLockout('user@example.com', 900);
    expect(await store.isLockedOut('user@example.com')).toBe(true);
    const ttl = await store.lockoutTtlSeconds('user@example.com');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(900);
  });

  it('lockout expires (simulated by time)', async () => {
    const store = new InMemoryThrottleStore();
    await store.setLockout('expiring-key', 0); // 0-second TTL
    // Give the lockout map 1 ms to expire
    await new Promise((r) => setTimeout(r, 1));
    expect(await store.isLockedOut('expiring-key')).toBe(false);
  });

  it('reset() clears all state', async () => {
    const store = new InMemoryThrottleStore();
    await store.increment('k', 60);
    await store.setLockout('l', 900);
    store.reset();
    expect(await store.increment('k', 60)).toBe(1); // counter reset
    expect(await store.isLockedOut('l')).toBe(false);
  });
});
