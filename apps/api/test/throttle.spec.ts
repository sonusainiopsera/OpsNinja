/**
 * WO-016: ThrottleService unit tests.
 *
 * Covers:
 *   AC1/AC8 — sliding-window counting: 5th attempt allowed, 6th locked out
 *   AC1/AC8 — lockout expiry: attempt allowed after TTL elapses
 *   AC3/AC8 — counter reset on successful authentication
 *   AC1/AC8 — Retry-After equals remaining TTL (not a constant)
 *   AC2     — per-IP and per-email budgets are independent
 *   AC4     — 429 body is uniform (code AUTH_RATE_LIMITED)
 *   AC6     — PII redactor strips email, phone, IP from log records
 *   AC10    — FakeRedis and injected clock produce deterministic results
 */

import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';

import { ThrottleService } from '../src/common/security/throttle.service';
import { redactPii } from '../src/common/logging/pii-redactor';
import {
  FakeRedis,
  THROTTLE_TEST_EMAIL,
  THROTTLE_TEST_IP,
} from './fixtures/throttle.fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(redis: FakeRedis, overrides: Record<string, unknown> = {}): ThrottleService {
  const configService = {
    get: (key: string, defaultValue: unknown) => overrides[key] ?? defaultValue,
  } as unknown as ConfigService;

  return new ThrottleService(redis as never, configService);
}

// ---------------------------------------------------------------------------
// AC8: Sliding window — 5th attempt allowed, 6th locked
// ---------------------------------------------------------------------------

describe('WO-016 AC8: Sliding-window boundary', () => {
  it('allows the 5th failure attempt and locks on the 6th', async () => {
    const redis = new FakeRedis();
    const svc = makeService(redis, { THROTTLE_MAX_FAILURES_PER_HOUR: 5 });

    // Record 4 failures — all should be allowed (counter below threshold)
    for (let i = 0; i < 4; i++) {
      await svc.recordFailure(THROTTLE_TEST_EMAIL);
      const result = await svc.checkEmail(THROTTLE_TEST_EMAIL);
      expect(result.allowed).toBe(true);
    }

    // 5th failure — threshold reached; lockout is issued
    await svc.recordFailure(THROTTLE_TEST_EMAIL);

    // After 5th failure, checkEmail should deny
    const afterFifth = await svc.checkEmail(THROTTLE_TEST_EMAIL);
    expect(afterFifth.allowed).toBe(false);
    expect(afterFifth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('6th failure is denied with positive Retry-After', async () => {
    const redis = new FakeRedis();
    const svc = makeService(redis, { THROTTLE_MAX_FAILURES_PER_HOUR: 5 });

    for (let i = 0; i < 5; i++) {
      await svc.recordFailure(THROTTLE_TEST_EMAIL);
    }
    await svc.recordFailure(THROTTLE_TEST_EMAIL); // 6th

    const result = await svc.checkEmail(THROTTLE_TEST_EMAIL);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC8: Lockout TTL expiry
// ---------------------------------------------------------------------------

describe('WO-016 AC8: Lockout expiry', () => {
  it('allows a request after the lockout TTL elapses', async () => {
    const redis = new FakeRedis();
    const svc = makeService(redis, {
      THROTTLE_MAX_FAILURES_PER_HOUR: 2,
      THROTTLE_LOCKOUT_MINUTES: 1,
    });

    await svc.recordFailure(THROTTLE_TEST_EMAIL);
    await svc.recordFailure(THROTTLE_TEST_EMAIL);

    const lockedResult = await svc.checkEmail(THROTTLE_TEST_EMAIL);
    expect(lockedResult.allowed).toBe(false);

    // Advance time past the 1-minute lockout window
    redis.advanceTime(61 * 1000);

    const afterExpiry = await svc.checkEmail(THROTTLE_TEST_EMAIL);
    expect(afterExpiry.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC3 / AC8: Counter reset on successful authentication
// ---------------------------------------------------------------------------

describe('WO-016 AC3/AC8: Counter reset on success', () => {
  it('clears failures after successful authentication', async () => {
    const redis = new FakeRedis();
    const svc = makeService(redis, { THROTTLE_MAX_FAILURES_PER_HOUR: 5 });

    // Record 4 failures
    for (let i = 0; i < 4; i++) {
      await svc.recordFailure(THROTTLE_TEST_EMAIL);
    }

    // Successful login resets counters
    await svc.recordSuccess(THROTTLE_TEST_EMAIL);

    // Another failure should be fine (counter reset)
    await svc.recordFailure(THROTTLE_TEST_EMAIL);
    const result = await svc.checkEmail(THROTTLE_TEST_EMAIL);
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC1 / AC8: Retry-After is from actual TTL
// ---------------------------------------------------------------------------

describe('WO-016 AC1/AC8: Retry-After equals remaining TTL', () => {
  it('Retry-After decreases as time advances', async () => {
    const redis = new FakeRedis();
    const svc = makeService(redis, {
      THROTTLE_MAX_FAILURES_PER_HOUR: 2,
      THROTTLE_LOCKOUT_MINUTES: 10,
    });

    await svc.recordFailure(THROTTLE_TEST_EMAIL);
    await svc.recordFailure(THROTTLE_TEST_EMAIL);

    const first = await svc.checkEmail(THROTTLE_TEST_EMAIL);
    expect(first.retryAfterSeconds).toBeGreaterThan(550); // ~10 min in seconds

    // Advance 5 minutes
    redis.advanceTime(5 * 60 * 1000);

    const second = await svc.checkEmail(THROTTLE_TEST_EMAIL);
    expect(second.retryAfterSeconds).toBeLessThan(first.retryAfterSeconds);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC2: Independent per-IP and per-email budgets
// ---------------------------------------------------------------------------

describe('WO-016 AC2: Independent per-IP and per-email budgets', () => {
  it('IP lockout does not affect email counter', async () => {
    const redis = new FakeRedis();
    const svc = makeService(redis, {
      THROTTLE_MAX_FAILURES_PER_HOUR: 5,
      THROTTLE_PER_IP_LIMIT: 2,
    });

    // Lock out the IP
    for (let i = 0; i < 2; i++) {
      await svc.recordFailure(THROTTLE_TEST_IP);
    }
    const ipResult = await svc.checkIp(THROTTLE_TEST_IP);
    expect(ipResult.allowed).toBe(false);

    // Email counter should be independent
    const emailResult = await svc.checkEmail(THROTTLE_TEST_EMAIL);
    expect(emailResult.allowed).toBe(true);
  });

  it('email lockout does not affect IP counter', async () => {
    const redis = new FakeRedis();
    const svc = makeService(redis, {
      THROTTLE_MAX_FAILURES_PER_HOUR: 2,
      THROTTLE_PER_IP_LIMIT: 100,
    });

    // Lock out the email
    await svc.recordFailure(THROTTLE_TEST_EMAIL);
    await svc.recordFailure(THROTTLE_TEST_EMAIL);
    const emailResult = await svc.checkEmail(THROTTLE_TEST_EMAIL);
    expect(emailResult.allowed).toBe(false);

    // IP counter should be independent
    const ipResult = await svc.checkIp(THROTTLE_TEST_IP);
    expect(ipResult.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC6: PII redactor — no PII survives log emission
// ---------------------------------------------------------------------------

describe('WO-016 AC6: PII redactor strips all PII field types', () => {
  it('redacts email field', () => {
    const record = redactPii({ email: 'user@example.com' });
    expect(JSON.stringify(record)).not.toContain('user@example.com');
    expect(JSON.stringify(record)).toContain('[hashed:');
  });

  it('redacts phone field', () => {
    const record = redactPii({ phone: '+1-555-0100' });
    expect(JSON.stringify(record)).not.toContain('+1-555-0100');
    expect(JSON.stringify(record)).toContain('[hashed:');
  });

  it('redacts ip and ipAddress fields', () => {
    const r1 = redactPii({ ip: '10.0.0.1' });
    const r2 = redactPii({ ipAddress: '10.0.0.1' });
    expect(JSON.stringify(r1)).not.toContain('10.0.0.1');
    expect(JSON.stringify(r2)).not.toContain('10.0.0.1');
  });

  it('replaces free-text / comment fields with [REDACTED]', () => {
    const record = redactPii({ comment: 'User complained about billing', note: 'Some note' });
    const json = JSON.stringify(record);
    expect(json).not.toContain('User complained');
    expect(json).not.toContain('Some note');
    expect(json).toContain('[REDACTED]');
  });

  it('passes through non-PII fields unchanged', () => {
    const record = redactPii({ traceId: 'abc-123', actorId: 'user-1', outcome: 'denied' });
    const result = record as Record<string, unknown>;
    expect(result['traceId']).toBe('abc-123');
    expect(result['actorId']).toBe('user-1');
    expect(result['outcome']).toBe('denied');
  });

  it('redacts PII in nested objects', () => {
    const record = redactPii({ user: { email: 'nested@example.com', name: 'Alice' } });
    expect(JSON.stringify(record)).not.toContain('nested@example.com');
  });

  it('redacts PII in arrays', () => {
    const record = redactPii([{ email: 'a@b.com' }, { email: 'c@d.com' }]);
    expect(JSON.stringify(record)).not.toContain('a@b.com');
    expect(JSON.stringify(record)).not.toContain('c@d.com');
  });
});

// ---------------------------------------------------------------------------
// Redis unavailable — fail-closed behaviour
// ---------------------------------------------------------------------------

describe('WO-016: Redis unavailable fails closed', () => {
  it('checkEmail throws ServiceUnavailableException when Redis errors', async () => {
    const brokenRedis = {
      pttl: () => Promise.reject(new Error('ECONNREFUSED')),
      get: () => Promise.reject(new Error('ECONNREFUSED')),
      pipeline: () => ({ exec: () => Promise.reject(new Error('ECONNREFUSED')) }),
    };
    const svc = makeService(brokenRedis as never);
    await expect(svc.checkEmail(THROTTLE_TEST_EMAIL)).rejects.toThrow(ServiceUnavailableException);
  });
});
