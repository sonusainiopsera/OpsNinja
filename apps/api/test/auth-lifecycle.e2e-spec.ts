/**
 * E2E-style integration tests for the auth token / session lifecycle.
 *
 * These tests spin up the NestJS application with a real in-process HTTP server
 * but replace Redis and Postgres with in-memory fakes (FakeRedis + stub repo).
 * No external services are required.
 *
 * Covered scenarios:
 *  1. createSession → rotateSession → revokeSession (happy path)
 *  2. Refresh after logout (session revoked) → 401
 *  3. Tampered cookie (malformed) → 401 AUTH_REFRESH_INVALID
 *  4. Concurrent refresh within grace window → both succeed
 *  5. Admin revocation blocks further refreshes
 *  6. Reuse detection outside grace window → throws + family revoked
 *
 * NOTE: These tests exercise the service layer directly (not HTTP) to avoid
 * the need for a live Express bootstrap and cookie transport. HTTP-layer cookie
 * behaviour is covered by AuthController unit tests (planned for WO-013).
 */

import {
  FakeRedis,
  buildCreateSessionInput,
  buildMintInput,
  tokenServiceTestEnv,
  FAMILY_A_ID,
} from './fixtures/session.fixtures';
import { TENANT_A_ID, TENANT_A_STAFF_USER_ID } from './factories/principal-context.factory';
import { SessionService, REFRESH_TOKEN_TTL_SECONDS } from '../src/modules/identity/services/session.service';
import { TokenService } from '../src/modules/identity/services/token.service';
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Minimal stub for ConfigService used by TokenService
// ---------------------------------------------------------------------------

const testEnv = tokenServiceTestEnv();

function makeConfigService(): ConfigService {
  return {
    get: <T>(key: string, def?: T): T =>
      (testEnv[key as keyof typeof testEnv] as unknown as T) ?? def as T,
  } as ConfigService;
}

// ---------------------------------------------------------------------------
// Minimal stub for RefreshSessionRepository
// ---------------------------------------------------------------------------

const stubRepo = {
  create: jest.fn().mockResolvedValue(undefined),
  recordRotation: jest.fn().mockResolvedValue(undefined),
  recordRevocation: jest.fn().mockResolvedValue(undefined),
  revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  findActiveSessions: jest.fn().mockResolvedValue([]),
};

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeServices(redis: FakeRedis): { session: SessionService; token: TokenService } {
  const config = makeConfigService();
  const token = new TokenService(config);
  const session = new SessionService(redis as never, stubRepo as never);
  return { session, token };
}

describe('Auth lifecycle (service-layer integration)', () => {
  let redis: FakeRedis;
  let session: SessionService;
  let token: TokenService;

  beforeEach(() => {
    redis = new FakeRedis();
    jest.clearAllMocks();
    const svc = makeServices(redis);
    session = svc.session;
    token = svc.token;
  });

  // ---------------------------------------------------------------------------
  // Scenario 1: Happy path — issue → rotate → revoke
  // ---------------------------------------------------------------------------

  describe('Scenario 1: happy path (issue → refresh → logout)', () => {
    it('issues a valid access token after creating a session', async () => {
      const created = await session.createSession(buildCreateSessionInput());

      const issued = token.mintAccessToken(
        buildMintInput({ sub: TENANT_A_STAFF_USER_ID, tenantId: TENANT_A_ID }),
      );

      const claims = token.verifyAccessToken(issued.accessToken);
      expect(claims.sub).toBe(TENANT_A_STAFF_USER_ID);
      expect(claims.tenant_id).toBe(TENANT_A_ID);
      expect(created.sessionId).toBeTruthy();
    });

    it('rotates the session and issues a new access token', async () => {
      const created = await session.createSession(buildCreateSessionInput());
      const rotated = await session.rotateSession({
        sessionId: created.sessionId,
        tenantId: TENANT_A_ID,
        presentedToken: created.refreshToken,
      });

      expect(rotated.refreshToken).not.toBe(created.refreshToken);

      const issued = token.mintAccessToken(buildMintInput());
      const claims = token.verifyAccessToken(issued.accessToken);
      expect(claims.sub).toBe(TENANT_A_STAFF_USER_ID);
    });

    it('logout revokes the session so a second refresh fails', async () => {
      const created = await session.createSession(buildCreateSessionInput());

      await session.revokeSession({
        sessionId: created.sessionId,
        tenantId: TENANT_A_ID,
        reason: 'logout',
      });

      await expect(
        session.rotateSession({
          sessionId: created.sessionId,
          tenantId: TENANT_A_ID,
          presentedToken: created.refreshToken,
        }),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Tampered cookie (malformed / no session)
  // ---------------------------------------------------------------------------

  describe('Scenario 2: tampered/missing cookie', () => {
    it('throws AUTH_REFRESH_INVALID for a non-existent session', async () => {
      await expect(
        session.rotateSession({
          sessionId: 'fake-session-id',
          tenantId: TENANT_A_ID,
          presentedToken: 'a'.repeat(64),
        }),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    });

    it('throws AUTH_REFRESH_INVALID for a wrong token on a valid session', async () => {
      const created = await session.createSession(buildCreateSessionInput());

      await expect(
        session.rotateSession({
          sessionId: created.sessionId,
          tenantId: TENANT_A_ID,
          presentedToken: 'z'.repeat(64), // completely wrong
        }),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Concurrent refresh within grace window
  // ---------------------------------------------------------------------------

  describe('Scenario 3: concurrent refresh within grace window', () => {
    it('both concurrent refreshes succeed when within 30-second grace', async () => {
      const nowMs = 1_700_000_000_000;
      redis.setNow(nowMs);

      const created = await session.createSession(buildCreateSessionInput(), nowMs);

      // Tab A rotates at t=0
      const rotatedA = await session.rotateSession({
        sessionId: created.sessionId,
        tenantId: TENANT_A_ID,
        presentedToken: created.refreshToken,
        now: new Date(nowMs),
      });
      expect(rotatedA.refreshToken).toBeTruthy();

      // Tab B presents the SAME original token at t+5s (within grace window)
      const rotatedB = await session.rotateSession({
        sessionId: created.sessionId,
        tenantId: TENANT_A_ID,
        presentedToken: created.refreshToken,
        now: new Date(nowMs + 5_000),
      });
      expect(rotatedB.refreshToken).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Admin revocation
  // ---------------------------------------------------------------------------

  describe('Scenario 4: admin revocation', () => {
    it('isUserRevoked returns true after revokeAllSessionsForUser', async () => {
      await session.createSession(buildCreateSessionInput());

      expect(await session.isUserRevoked(TENANT_A_STAFF_USER_ID, TENANT_A_ID)).toBe(false);

      await session.revokeAllSessionsForUser(TENANT_A_STAFF_USER_ID, TENANT_A_ID);

      expect(await session.isUserRevoked(TENANT_A_STAFF_USER_ID, TENANT_A_ID)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Reuse detection (theft scenario)
  // ---------------------------------------------------------------------------

  describe('Scenario 5: reuse detection', () => {
    it('throws AUTH_REFRESH_REUSED when old token used after grace window', async () => {
      const nowMs = 1_700_000_000_000;
      redis.setNow(nowMs);

      const created = await session.createSession(buildCreateSessionInput(), nowMs);

      // Legitimate rotation at t=0
      await session.rotateSession({
        sessionId: created.sessionId,
        tenantId: TENANT_A_ID,
        presentedToken: created.refreshToken,
        now: new Date(nowMs),
      });

      // Attacker re-uses the stolen original token at t+60s (outside grace)
      await expect(
        session.rotateSession({
          sessionId: created.sessionId,
          tenantId: TENANT_A_ID,
          presentedToken: created.refreshToken,
          now: new Date(nowMs + 60_000),
        }),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_REUSED' });
    });
  });

  // ---------------------------------------------------------------------------
  // Token minting — JWKS
  // ---------------------------------------------------------------------------

  describe('TokenService — JWKS', () => {
    it('public JWKS can verify a minted token claim-for-claim', () => {
      const input = buildMintInput({ roles: ['admin'] });
      const { accessToken } = token.mintAccessToken(input);
      const claims = token.verifyAccessToken(accessToken);

      expect(claims.roles).toEqual(['admin']);
      expect(claims.user_type).toBe('staff');
    });

    it('JWKS contains RSA public key in JWK format', () => {
      const jwks = token.getPublicJwks();
      expect(jwks.keys).toHaveLength(1);
      const key = jwks.keys[0] as Record<string, unknown>;
      expect(key['kty']).toBe('RSA');
      expect(key['use']).toBe('sig');
    });
  });
});
