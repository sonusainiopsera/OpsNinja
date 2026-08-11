/**
 * Unit tests for ThrottleService (WO-016).
 *
 * All tests use the FakeRedis fixture and run entirely offline.
 * Tests verify exact window boundary behaviour, lockout expiry,
 * counter reset on success, and Retry-After computation.
 */

import { TooManyRequestsException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottleService } from '../throttle.service';
import { makeFakeRedis, TEST_EMAILS, TEST_IPS } from '../../../../test/fixtures/throttle.fixtures';

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const defaults: Record<string, unknown> = {
    THROTTLE_MAX_FAILURES: 5,
    THROTTLE_WINDOW_SECONDS: 3600,
    THROTTLE_LOCKOUT_SECONDS: 900,
    THROTTLE_PER_IP_LIMIT: 100,
    THROTTLE_PER_IP_WINDOW_SECONDS: 3600,
    ...overrides,
  };
  return {
    get: jest.fn(<T>(key: string, defaultVal?: T): T =>
      (key in defaults ? defaults[key] : defaultVal) as T,
    ),
  } as unknown as ConfigService;
}

// ── hashSubject ───────────────────────────────────────────────────────────────

describe('ThrottleService.hashSubject', () => {
  it('returns a 64-char hex string (SHA-256)', () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig());
    const h = svc.hashSubject('email', TEST_EMAILS.user1);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalises email to lowercase before hashing', () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig());
    const h1 = svc.hashSubject('email', 'USER@EXAMPLE.INVALID');
    const h2 = svc.hashSubject('email', 'user@example.invalid');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different subject types', () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig());
    const emailHash = svc.hashSubject('email', 'x@x.invalid');
    const ipHash    = svc.hashSubject('ip', 'x@x.invalid');
    expect(emailHash).not.toBe(ipHash);
  });

  it('produces different hashes for different subjects', () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig());
    const h1 = svc.hashSubject('email', TEST_EMAILS.user1);
    const h2 = svc.hashSubject('email', TEST_EMAILS.user2);
    expect(h1).not.toBe(h2);
  });
});

// ── checkAndRecord — window boundary ─────────────────────────────────────────

describe('ThrottleService.checkAndRecord — window boundary', () => {
  it('allows the first maxFailures attempts (5th attempt allowed)', async () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig({ THROTTLE_MAX_FAILURES: 5 }));

    for (let i = 0; i < 5; i++) {
      await expect(svc.checkAndRecord('email', TEST_EMAILS.user1, true)).resolves.toBeUndefined();
    }
  });

  it('locks on the 6th attempt (maxFailures + 1)', async () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig({ THROTTLE_MAX_FAILURES: 5 }));

    for (let i = 0; i < 5; i++) {
      await svc.checkAndRecord('email', TEST_EMAILS.user1, true);
    }

    await expect(svc.checkAndRecord('email', TEST_EMAILS.user1, true))
      .rejects.toBeInstanceOf(TooManyRequestsException);
  });

  it('subsequent attempts after lockout also return 429', async () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig({ THROTTLE_MAX_FAILURES: 2 }));

    await svc.checkAndRecord('email', TEST_EMAILS.user1, true);
    await svc.checkAndRecord('email', TEST_EMAILS.user1, true); // triggers lockout
    await expect(svc.checkAndRecord('email', TEST_EMAILS.user1, false))
      .rejects.toBeInstanceOf(TooManyRequestsException);
  });

  it('TooManyRequestsException has AUTH_RATE_LIMITED code', async () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig({ THROTTLE_MAX_FAILURES: 1 }));

    await svc.checkAndRecord('email', TEST_EMAILS.user1, true); // triggers on first (maxFailures=1)
    try {
      await svc.checkAndRecord('email', TEST_EMAILS.user1, true);
      fail('expected TooManyRequestsException');
    } catch (err) {
      expect(err).toBeInstanceOf(TooManyRequestsException);
      expect((err as TooManyRequestsException).getResponse()).toMatchObject({
        code: 'AUTH_RATE_LIMITED',
      });
    }
  });
});

// ── lockout expiry ────────────────────────────────────────────────────────────

describe('ThrottleService lockout expiry', () => {
  it('allows access after lockout TTL expires', async () => {
    const { redis, advanceTime } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig({
      THROTTLE_MAX_FAILURES: 1,
      THROTTLE_LOCKOUT_SECONDS: 900,
    }));

    // Trigger lockout
    await svc.checkAndRecord('email', TEST_EMAILS.user1, true);
    await expect(svc.checkAndRecord('email', TEST_EMAILS.user1, false))
      .rejects.toBeInstanceOf(TooManyRequestsException);

    // Advance time past the lockout window
    advanceTime(901 * 1000); // 901 seconds

    // Should now be allowed (lockout key expired in the fake Redis)
    await expect(svc.checkAndRecord('email', TEST_EMAILS.user1, true)).resolves.toBeUndefined();
  });
});

// ── counter reset on success ──────────────────────────────────────────────────

describe('ThrottleService.resetCounters', () => {
  it('clears both count and lockout keys', async () => {
    const { redis, state } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig({ THROTTLE_MAX_FAILURES: 5 }));

    // Record 3 failures
    for (let i = 0; i < 3; i++) {
      await svc.checkAndRecord('email', TEST_EMAILS.user1, true);
    }

    const hash = svc.hashSubject('email', TEST_EMAILS.user1);
    expect(state.store.has(`throttle:count:${hash}`)).toBe(true);

    // Reset on successful auth
    await svc.resetCounters('email', TEST_EMAILS.user1);

    expect(state.store.has(`throttle:count:${hash}`)).toBe(false);
    expect(state.store.has(`throttle:locked:${hash}`)).toBe(false);
  });
});

// ── getLockoutTtl ─────────────────────────────────────────────────────────────

describe('ThrottleService.getLockoutTtl', () => {
  it('returns remaining TTL when locked', async () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig({
      THROTTLE_MAX_FAILURES: 1,
      THROTTLE_LOCKOUT_SECONDS: 900,
    }));

    await svc.checkAndRecord('email', TEST_EMAILS.user1, true);
    const ttl = await svc.getLockoutTtl('email', TEST_EMAILS.user1);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(900);
  });

  it('returns 0 when not locked', async () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig());
    const ttl = await svc.getLockoutTtl('email', TEST_EMAILS.user1);
    expect(ttl).toBe(0);
  });
});

// ── independent per-email and per-IP budgets ──────────────────────────────────

describe('ThrottleService independent email and IP budgets', () => {
  it('email lockout does not affect IP throttle', async () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig({ THROTTLE_MAX_FAILURES: 1 }));

    // Lock email
    await svc.checkAndRecord('email', TEST_EMAILS.user1, true);

    // IP should still be allowed
    await expect(svc.checkAndRecord('ip', TEST_IPS.office, true)).resolves.toBeUndefined();
  });

  it('IP lockout does not affect a different IP', async () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig({ THROTTLE_MAX_FAILURES: 1 }));

    await svc.checkAndRecord('ip', TEST_IPS.attacker, true);
    await expect(svc.checkAndRecord('ip', TEST_IPS.office, true)).resolves.toBeUndefined();
  });
});

// ── adminUnlock ───────────────────────────────────────────────────────────────

describe('ThrottleService.adminUnlock', () => {
  it('clears lockout and returns cleared TTL', async () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig({ THROTTLE_MAX_FAILURES: 1 }));

    await svc.checkAndRecord('email', TEST_EMAILS.user1, true);
    const cleared = await svc.adminUnlock('email', TEST_EMAILS.user1);
    expect(cleared).toBeGreaterThan(0);

    // Should now be allowed
    await expect(svc.checkAndRecord('email', TEST_EMAILS.user1, true)).resolves.toBeUndefined();
  });

  it('returns 0 when no lockout exists', async () => {
    const { redis } = makeFakeRedis();
    const svc = new ThrottleService(redis, makeConfig());
    const cleared = await svc.adminUnlock('email', TEST_EMAILS.user1);
    expect(cleared).toBe(0);
  });
});

// ── Redis unavailability — fail closed ───────────────────────────────────────

describe('ThrottleService Redis unavailability', () => {
  it('throws ServiceUnavailableException (503) when Redis throws on checkAndRecord', async () => {
    const { redis } = makeFakeRedis();
    (redis as unknown as { ttl: jest.Mock }).ttl
      = jest.fn().mockRejectedValue(new Error('connection refused'));

    const svc = new ThrottleService(redis, makeConfig());
    await expect(svc.checkAndRecord('email', TEST_EMAILS.user1, true))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does NOT throw on resetCounters when Redis is unavailable (best-effort reset)', async () => {
    const { redis } = makeFakeRedis();
    (redis as unknown as { pipeline: jest.Mock }).pipeline
      = jest.fn().mockImplementation(() => ({
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('connection refused')),
      }));

    const svc = new ThrottleService(redis, makeConfig());
    await expect(svc.resetCounters('email', TEST_EMAILS.user1)).resolves.toBeUndefined();
  });
});
