/**
 * Unit tests for SessionService.
 *
 * Uses a fake Redis, fake clock, and injected CSPRNG stubs so tests are
 * deterministic and run offline.
 */

import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { SessionService, REFRESH_TTL_S } from './session.service';
import {
  makeFakeRedis,
  makeSessionFixture,
  TENANT_A_ID,
} from '../../../test/fixtures/session.fixtures';
import { RefreshSessionRepository } from './repositories/refresh-session.repository';

// ── Fake clock ───────────────────────────────────────────────────────────────

const FIXED_NOW_MS = 1_700_000_000_000;

class TestableSvc extends SessionService {
  private _now = FIXED_NOW_MS;
  setNow(ms: number) { this._now = ms; }
  protected override now(): number { return this._now; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(): ConfigService {
  return { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
}

function makeRepo(): jest.Mocked<RefreshSessionRepository> {
  return {
    create: jest.fn().mockResolvedValue(undefined),
    recordRotation: jest.fn().mockResolvedValue(undefined),
    recordRevocation: jest.fn().mockResolvedValue(undefined),
    findActiveByUser: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<RefreshSessionRepository>;
}

function sha256hex(raw: string): string {
  return createHash('sha256').update(raw, 'hex').digest('hex');
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('SessionService', () => {
  let redis: ReturnType<typeof makeFakeRedis>;
  let repo: jest.Mocked<RefreshSessionRepository>;
  let svc: TestableSvc;

  beforeEach(() => {
    redis = makeFakeRedis();
    repo = makeRepo();
    svc = new TestableSvc(
      redis as never,
      repo,
      makeConfig(),
    );
    svc.setNow(FIXED_NOW_MS);
  });

  // ── createSession ──────────────────────────────────────────────────────────

  it('returns a raw token (not the hash) in the SessionToken', async () => {
    const token = await svc.createSession({
      tenantId: TENANT_A_ID,
      userId: 'user-1',
      principalKind: 'staff',
    });
    expect(token.rawToken).toHaveLength(64); // 32 bytes hex
  });

  it('stores SHA-256 hash in Redis, never the raw token', async () => {
    const token = await svc.createSession({
      tenantId: TENANT_A_ID,
      userId: 'user-1',
      principalKind: 'staff',
    });
    const key = `session:${TENANT_A_ID}:${token.sessionId}`;
    const stored = redis._store.get(key);
    expect(stored).toBeDefined();
    const storedHash = stored!.get('hash');
    expect(storedHash).toBe(sha256hex(token.rawToken));
    // Raw token must NOT appear in Redis
    expect(storedHash).not.toBe(token.rawToken);
  });

  it('sets Redis TTL to REFRESH_TTL_S (8 hours)', async () => {
    await svc.createSession({ tenantId: TENANT_A_ID, userId: 'u', principalKind: 'staff' });
    expect(redis.expire).toHaveBeenCalledWith(
      expect.stringContaining(`session:${TENANT_A_ID}:`),
      REFRESH_TTL_S,
    );
  });

  it('writes an audit row to Postgres', async () => {
    await svc.createSession({ tenantId: TENANT_A_ID, userId: 'u', principalKind: 'staff' });
    expect(repo.create).toHaveBeenCalledTimes(1);
    const call = repo.create.mock.calls[0][0];
    expect(call.tenantId).toBe(TENANT_A_ID);
    expect(call.isRevoked).toBe(false);
  });

  it('expiresAt is 8 hours after creation', async () => {
    const token = await svc.createSession({ tenantId: TENANT_A_ID, userId: 'u', principalKind: 'staff' });
    const expected = new Date(FIXED_NOW_MS + REFRESH_TTL_S * 1_000);
    expect(token.expiresAt.getTime()).toBe(expected.getTime());
  });

  // ── rotateSession ─────────────────────────────────────────────────────────

  it('ROTATED path: returns a new raw token and calls recordRotation', async () => {
    redis.evalsha.mockResolvedValueOnce([1, 'ROTATED', 'family-id-1']);
    redis.hmget.mockResolvedValueOnce(['user-1', 'staff', '["agent"]']);
    const result = await svc.rotateSession(TENANT_A_ID, 'session-1', 'old-token');
    expect(result.newRawToken).toHaveLength(64);
    expect(result.principal).toMatchObject({ userId: 'user-1', principalKind: 'staff', roles: ['agent'] });
    expect(repo.recordRotation).toHaveBeenCalledWith(TENANT_A_ID, 'session-1');
  });

  it('GRACE_ROTATED path: returns new token but skips recordRotation', async () => {
    redis.evalsha.mockResolvedValueOnce([2, 'GRACE_ROTATED', 'family-id-1']);
    redis.hmget.mockResolvedValueOnce(['user-1', 'portal', '[]']);
    const result = await svc.rotateSession(TENANT_A_ID, 'session-1', 'old-token');
    expect(result.newRawToken).toHaveLength(64);
    expect(result.principal.principalKind).toBe('portal');
    expect(repo.recordRotation).not.toHaveBeenCalled();
  });

  it('NOT_FOUND path: throws UnauthorizedException AUTH_REFRESH_INVALID', async () => {
    redis.evalsha.mockResolvedValueOnce([-1, 'NOT_FOUND', '']);
    await expect(svc.rotateSession(TENANT_A_ID, 'session-1', 'token')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.rotateSession(TENANT_A_ID, 'session-1', 'token')).rejects.toMatchObject({
      response: { code: 'AUTH_REFRESH_INVALID' },
    });
  });

  it('REVOKED path: throws UnauthorizedException AUTH_REFRESH_INVALID', async () => {
    redis.evalsha.mockResolvedValueOnce([-2, 'REVOKED', '']);
    await expect(svc.rotateSession(TENANT_A_ID, 'session-1', 'token')).rejects.toMatchObject({
      response: { code: 'AUTH_REFRESH_INVALID' },
    });
  });

  it('REPLAY_DETECTED: revokes family sessions and throws AUTH_REFRESH_REUSED', async () => {
    const familyId = 'family-abc';
    redis.evalsha.mockResolvedValueOnce([-3, 'REPLAY_DETECTED', familyId]);
    redis.smembers.mockResolvedValueOnce(['session-1', 'session-2']);

    await expect(
      svc.rotateSession(TENANT_A_ID, 'session-1', 'stale-token'),
    ).rejects.toMatchObject({ response: { code: 'AUTH_REFRESH_REUSED' } });

    // Family key queried
    expect(redis.smembers).toHaveBeenCalledWith(`session_family:${TENANT_A_ID}:${familyId}`);
    // Pipeline should have set revoked=1 on each session
    expect(redis.pipeline).toHaveBeenCalled();
  });

  // ── revokeSession ─────────────────────────────────────────────────────────

  it('sets revoked=1 in Redis for the session', async () => {
    await svc.revokeSession(TENANT_A_ID, 'session-1');
    expect(redis.hset).toHaveBeenCalledWith(
      `session:${TENANT_A_ID}:session-1`,
      'revoked',
      '1',
    );
    expect(repo.recordRevocation).toHaveBeenCalledWith(TENANT_A_ID, 'session-1');
  });

  // ── revokeAllSessionsForUser ───────────────────────────────────────────────

  it('revokes all active sessions returned by the repository', async () => {
    repo.findActiveByUser.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    const count = await svc.revokeAllSessionsForUser(TENANT_A_ID, 'user-1');
    expect(count).toBe(2);
    expect(redis.hset).toHaveBeenCalledWith(`session:${TENANT_A_ID}:s1`, 'revoked', '1');
    expect(redis.hset).toHaveBeenCalledWith(`session:${TENANT_A_ID}:s2`, 'revoked', '1');
  });

  // ── Cookie helpers ─────────────────────────────────────────────────────────

  it('buildRefreshCookie / parseRefreshCookie are inverse operations', async () => {
    const token = await svc.createSession({ tenantId: TENANT_A_ID, userId: 'u', principalKind: 'staff' });
    const cookie = svc.buildRefreshCookie(token);
    expect(typeof cookie).toBe('string');
    const parsed = svc.parseRefreshCookie(cookie);
    expect(parsed).not.toBeNull();
    expect(parsed!.tenantId).toBe(token.tenantId);
    expect(parsed!.sessionId).toBe(token.sessionId);
    expect(parsed!.rawToken).toBe(token.rawToken);
  });

  it('parseRefreshCookie returns null for garbage input', () => {
    expect(svc.parseRefreshCookie('')).toBeNull();
    expect(svc.parseRefreshCookie('not-base64url-valid-%%')).toBeNull();
    expect(svc.parseRefreshCookie('aGVsbG8=')).toBeNull(); // decodes to "hello" (no colons)
  });

  // ── Constant-time comparison ───────────────────────────────────────────────

  it('compareHashesConstantTime returns true for identical hashes', () => {
    const h = 'a'.repeat(64);
    expect(svc.compareHashesConstantTime(h, h)).toBe(true);
  });

  it('compareHashesConstantTime returns false for different hashes', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    expect(svc.compareHashesConstantTime(a, b)).toBe(false);
  });

  it('compareHashesConstantTime returns false when lengths differ', () => {
    expect(svc.compareHashesConstantTime('aabb', 'aabbcc')).toBe(false);
  });

  // ── Log redaction ──────────────────────────────────────────────────────────

  it('does not include the raw token or its hash in audit log output', async () => {
    const logSpy = jest.spyOn(svc['logger'], 'log');
    const token = await svc.createSession({
      tenantId: TENANT_A_ID,
      userId: 'u',
      principalKind: 'staff',
    });
    const hash = sha256hex(token.rawToken);
    for (const call of logSpy.mock.calls) {
      const serialised = JSON.stringify(call);
      expect(serialised).not.toContain(token.rawToken);
      expect(serialised).not.toContain(hash);
    }
  });

  // ── Fixture helper test ────────────────────────────────────────────────────

  it('makeSessionFixture produces a valid fixture with matching hash', () => {
    const f = makeSessionFixture();
    expect(sha256hex(f.rawToken)).toBe(f.hash);
  });
});
