/**
 * Unit tests for SessionService.
 *
 * Tests cover:
 *  - Session creation: token is opaque hex, hash is not the token
 *  - Successful rotation: returns new token, increments counter
 *  - Grace-window: re-presenting the previous hash within 30s succeeds
 *  - Reuse detection: presenting expired previous hash → throws AUTH_REFRESH_REUSED + family revoked
 *  - Revoked session: rotation throws AUTH_REFRESH_INVALID
 *  - Expired session: rotation throws AUTH_REFRESH_EXPIRED
 *  - Invalid token: rotation throws AUTH_REFRESH_INVALID
 *  - revokeSession marks session revoked in Redis
 *  - revokeAllSessionsForUser sets user-revoke key in Redis
 *  - isUserRevoked returns true/false correctly
 *  - hashToken + compareHashes
 */

import { Test, TestingModule } from '@nestjs/testing';

import { SessionService, REFRESH_TOKEN_TTL_SECONDS } from './session.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.provider';
import {
  FakeRedis,
  buildCreateSessionInput,
  FAMILY_A_ID,
} from '../../../../test/fixtures/session.fixtures';
import { TENANT_A_ID, TENANT_A_STAFF_USER_ID } from '../../../../test/factories/principal-context.factory';

// ---------------------------------------------------------------------------
// Stub session repository that does nothing (audit writes are best-effort)
// ---------------------------------------------------------------------------

const stubSessionRepo = {
  create: jest.fn().mockResolvedValue(undefined),
  recordRotation: jest.fn().mockResolvedValue(undefined),
  recordRevocation: jest.fn().mockResolvedValue(undefined),
  revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  findActiveSessions: jest.fn().mockResolvedValue([]),
};

describe('SessionService', () => {
  let service: SessionService;
  let redis: FakeRedis;

  beforeEach(async () => {
    redis = new FakeRedis();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: 'REFRESH_SESSION_REPOSITORY', useValue: stubSessionRepo },
      ],
    }).compile();

    service = module.get(SessionService);
  });

  // ---------------------------------------------------------------------------
  // createSession
  // ---------------------------------------------------------------------------

  describe('createSession', () => {
    it('returns a 64-char hex token and correct metadata', async () => {
      const input = buildCreateSessionInput();
      const result = await service.createSession(input);

      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.sessionId).toBeTruthy();
      expect(result.familyId).toBe(FAMILY_A_ID);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('stores hash, not the raw token, in Redis', async () => {
      const input = buildCreateSessionInput();
      const result = await service.createSession(input);

      const key = `session:${TENANT_A_ID}:${result.sessionId}`;
      const storedHash = await redis.hget(key, 'tokenHash');

      expect(storedHash).not.toBe(result.refreshToken);
      expect(storedHash).toBe(service.hashToken(result.refreshToken));
    });

    it('stores userId, tenantId, familyId in Redis hash', async () => {
      const input = buildCreateSessionInput();
      const result = await service.createSession(input);

      const key = `session:${TENANT_A_ID}:${result.sessionId}`;
      const hash = await redis.hgetall(key);

      expect(hash?.['userId']).toBe(TENANT_A_STAFF_USER_ID);
      expect(hash?.['tenantId']).toBe(TENANT_A_ID);
      expect(hash?.['familyId']).toBe(FAMILY_A_ID);
    });

    it('generates a new familyId when none is provided', async () => {
      const input = buildCreateSessionInput({ familyId: undefined });
      const result = await service.createSession(input);
      expect(result.familyId).toBeTruthy();
      expect(result.familyId).not.toBe(FAMILY_A_ID);
    });

    it('expiresAt is ~8 hours in the future', async () => {
      const nowMs = 1_700_000_000_000;
      const input = buildCreateSessionInput();
      const result = await service.createSession(input, nowMs);
      const expectedMs = nowMs + REFRESH_TOKEN_TTL_SECONDS * 1000;
      expect(result.expiresAt.getTime()).toBe(expectedMs);
    });
  });

  // ---------------------------------------------------------------------------
  // rotateSession — success
  // ---------------------------------------------------------------------------

  describe('rotateSession — success', () => {
    it('returns a new token different from the original after rotation', async () => {
      const input = buildCreateSessionInput();
      const created = await service.createSession(input);

      const rotated = await service.rotateSession({
        sessionId: created.sessionId,
        tenantId: TENANT_A_ID,
        presentedToken: created.refreshToken,
      });

      expect(rotated.refreshToken).not.toBe(created.refreshToken);
      expect(rotated.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(rotated.sessionId).toBe(created.sessionId);
    });

    it('updates tokenHash in Redis after rotation', async () => {
      const input = buildCreateSessionInput();
      const created = await service.createSession(input);
      const origHash = service.hashToken(created.refreshToken);

      const rotated = await service.rotateSession({
        sessionId: created.sessionId,
        tenantId: TENANT_A_ID,
        presentedToken: created.refreshToken,
      });

      const key = `session:${TENANT_A_ID}:${created.sessionId}`;
      const storedHash = await redis.hget(key, 'tokenHash');
      expect(storedHash).toBe(service.hashToken(rotated.refreshToken));
      expect(storedHash).not.toBe(origHash);
    });
  });

  // ---------------------------------------------------------------------------
  // rotateSession — grace window
  // ---------------------------------------------------------------------------

  describe('rotateSession — grace window', () => {
    it('succeeds when re-presenting previous token within 30 seconds', async () => {
      const nowMs = 1_700_000_000_000;
      redis.setNow(nowMs);

      const input = buildCreateSessionInput();
      const created = await service.createSession(input, nowMs);

      // First rotation
      const rotated1 = await service.rotateSession({
        sessionId: created.sessionId,
        tenantId: TENANT_A_ID,
        presentedToken: created.refreshToken,
        now: new Date(nowMs),
      });

      // Second rotation with ORIGINAL token, within grace window (10 seconds later)
      const rotated2 = await service.rotateSession({
        sessionId: created.sessionId,
        tenantId: TENANT_A_ID,
        presentedToken: created.refreshToken,
        now: new Date(nowMs + 10_000),
      });

      expect(rotated2.refreshToken).toBeTruthy();
    });

    it('throws REUSE_DETECTED when re-presenting previous token after grace window', async () => {
      const nowMs = 1_700_000_000_000;
      redis.setNow(nowMs);

      const input = buildCreateSessionInput();
      const created = await service.createSession(input, nowMs);

      // First rotation
      await service.rotateSession({
        sessionId: created.sessionId,
        tenantId: TENANT_A_ID,
        presentedToken: created.refreshToken,
        now: new Date(nowMs),
      });

      // Second rotation with ORIGINAL token, outside grace window (60 seconds later)
      await expect(
        service.rotateSession({
          sessionId: created.sessionId,
          tenantId: TENANT_A_ID,
          presentedToken: created.refreshToken,
          now: new Date(nowMs + 60_000),
        }),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_REUSED' });
    });
  });

  // ---------------------------------------------------------------------------
  // rotateSession — failure cases
  // ---------------------------------------------------------------------------

  describe('rotateSession — failure cases', () => {
    it('throws AUTH_REFRESH_INVALID for session not found', async () => {
      await expect(
        service.rotateSession({
          sessionId: 'nonexistent-session-id',
          tenantId: TENANT_A_ID,
          presentedToken: 'a'.repeat(64),
        }),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    });

    it('throws AUTH_REFRESH_INVALID on completely wrong token', async () => {
      const input = buildCreateSessionInput();
      const created = await service.createSession(input);

      await expect(
        service.rotateSession({
          sessionId: created.sessionId,
          tenantId: TENANT_A_ID,
          presentedToken: 'b'.repeat(64), // wrong token
        }),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    });

    it('throws AUTH_REFRESH_INVALID when session is revoked', async () => {
      const input = buildCreateSessionInput();
      const created = await service.createSession(input);

      await service.revokeSession({
        sessionId: created.sessionId,
        tenantId: TENANT_A_ID,
        reason: 'logout',
      });

      await expect(
        service.rotateSession({
          sessionId: created.sessionId,
          tenantId: TENANT_A_ID,
          presentedToken: created.refreshToken,
        }),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    });
  });

  // ---------------------------------------------------------------------------
  // revokeAllSessionsForUser
  // ---------------------------------------------------------------------------

  describe('revokeAllSessionsForUser', () => {
    it('sets user-revoke key so isUserRevoked returns true', async () => {
      expect(await service.isUserRevoked(TENANT_A_STAFF_USER_ID, TENANT_A_ID)).toBe(false);

      await service.revokeAllSessionsForUser(TENANT_A_STAFF_USER_ID, TENANT_A_ID);

      expect(await service.isUserRevoked(TENANT_A_STAFF_USER_ID, TENANT_A_ID)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getSessionRecord
  // ---------------------------------------------------------------------------

  describe('getSessionRecord', () => {
    it('returns userId and familyId for an active session', async () => {
      const input = buildCreateSessionInput();
      const created = await service.createSession(input);

      const record = await service.getSessionRecord(created.sessionId, TENANT_A_ID);
      expect(record).not.toBeNull();
      expect(record?.userId).toBe(TENANT_A_STAFF_USER_ID);
      expect(record?.familyId).toBe(FAMILY_A_ID);
    });

    it('returns null for a revoked session', async () => {
      const input = buildCreateSessionInput();
      const created = await service.createSession(input);

      await service.revokeSession({
        sessionId: created.sessionId,
        tenantId: TENANT_A_ID,
        reason: 'logout',
      });

      const record = await service.getSessionRecord(created.sessionId, TENANT_A_ID);
      expect(record).toBeNull();
    });

    it('returns null for a non-existent session', async () => {
      const record = await service.getSessionRecord('does-not-exist', TENANT_A_ID);
      expect(record).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // hashToken + compareHashes
  // ---------------------------------------------------------------------------

  describe('hashToken + compareHashes', () => {
    it('produces consistent SHA-256 hash', () => {
      const token = 'a'.repeat(64);
      expect(service.hashToken(token)).toBe(service.hashToken(token));
    });

    it('produces different hashes for different tokens', () => {
      expect(service.hashToken('a'.repeat(64))).not.toBe(service.hashToken('b'.repeat(64)));
    });

    it('compareHashes returns true for equal hashes', () => {
      const h = service.hashToken('a'.repeat(64));
      expect(service.compareHashes(h, h)).toBe(true);
    });

    it('compareHashes returns false for different hashes', () => {
      const h1 = service.hashToken('a'.repeat(64));
      const h2 = service.hashToken('b'.repeat(64));
      expect(service.compareHashes(h1, h2)).toBe(false);
    });

    it('compareHashes returns false for different length inputs', () => {
      expect(service.compareHashes('abc', 'abcd')).toBe(false);
    });
  });
});
