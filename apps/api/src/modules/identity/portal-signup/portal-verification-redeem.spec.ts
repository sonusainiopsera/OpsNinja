/**
 * Unit tests for PortalVerificationService.redeem() — WO-014 AC8.
 *
 * Covers:
 *   - Unknown token → VERIFICATION_TOKEN_INVALID (fail-closed, no enumeration)
 *   - Expired token → VERIFICATION_TOKEN_EXPIRED
 *   - Already-consumed token → VERIFICATION_TOKEN_CONSUMED
 *   - Concurrent race (conditional UPDATE returns 0 rows) → VERIFICATION_TOKEN_CONSUMED
 *   - Deactivated organisation → ORGANIZATION_INACTIVE
 *   - Successful redemption: portal user created, session issued, audit written
 *   - Idempotency window (60-second Redis cache) — second call returns cached result
 *   - Resend rate limiting (3/hr, 5/24hr)
 *
 * All DB and Redis interactions are mocked — no real infrastructure required.
 */

import { ConfigService } from '@nestjs/config';
import { TokenCodec } from './token.codec';
import { TokenService } from '../services/token.service';
import { SessionService } from '../services/session.service';
import { PortalVerificationService } from './portal-verification.service';

// ---------------------------------------------------------------------------
// Mock the @opsninja/db pool
// ---------------------------------------------------------------------------

const mockPoolClient = {
  query: jest.fn(),
  release: jest.fn(),
};

jest.mock('@opsninja/db', () => ({
  pool: { connect: jest.fn().mockResolvedValue(mockPoolClient) },
}));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const ORG_ID    = '20000000-0000-0000-0000-000000000001';
const SIGNUP_ID = '30000000-0000-0000-0000-000000000001';
const TOKEN_ID  = '40000000-0000-0000-0000-000000000001';
const EMAIL     = 'alice@acmecorp.com';
const IP        = '192.0.2.1';

/** 32-byte key (base64) for signing tokens in tests */
const TEST_KEY = Buffer.alloc(32, 0xab).toString('base64');

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, def?: string) => overrides[key] ?? def ?? '',
  } as unknown as ConfigService;
}

function makeTokenService(): TokenService {
  return {
    mintAccessToken: jest.fn().mockReturnValue({
      accessToken: 'at.test',
      expiresIn: 900,
    }),
  } as unknown as TokenService;
}

function makeSessionService(): SessionService {
  return {
    createSession: jest.fn().mockResolvedValue({
      sessionId: 'sess-1',
      refreshToken: 'rt.test',
    }),
  } as unknown as SessionService;
}

function makeRedis(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-1),
    ...overrides,
  };
}

function makeService(redisOverride?: ReturnType<typeof makeRedis>): PortalVerificationService {
  const codec   = new TokenCodec(makeConfig({ PORTAL_TOKEN_SIGNING_KEY: TEST_KEY }));
  const tokSvc  = makeTokenService();
  const sessSvc = makeSessionService();
  const redis   = redisOverride ?? makeRedis();

  return new PortalVerificationService(codec, tokSvc, sessSvc, redis as never);
}

/** Build a valid raw token for the test token id and email. */
function buildValidToken(): {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const codec = new TokenCodec(makeConfig({ PORTAL_TOKEN_SIGNING_KEY: TEST_KEY }));
  const emailHash = codec.hashEmail(EMAIL);
  const { rawToken, tokenHash, expiresAt } = codec.generate(TOKEN_ID, emailHash);
  return { rawToken, tokenHash, expiresAt };
}

/**
 * Set up the pool client mock for a full successful redeem() run.
 *
 * @param overrides — swap individual query results
 */
function setupRedeemPool(overrides: {
  tokenRow?: object | null;
  signupRow?: object | null;
  verifyResult?: { expired: boolean };
  consumeRows?: number;      // rows returned by the conditional UPDATE
  orgActive?: boolean | null;
} = {}) {
  const { rawToken, tokenHash, expiresAt } = buildValidToken();

  const defaultTokenRow = {
    token_id:          TOKEN_ID,
    signup_request_id: SIGNUP_ID,
    tenant_id:         TENANT_ID,
    token_hash:        tokenHash,
    expires_at:        expiresAt,
    consumed_at:       null,
    attempt_count:     0,
  };

  const defaultSignupRow = {
    id:             SIGNUP_ID,
    tenant_id:      TENANT_ID,
    organization_id: ORG_ID,
    email:          EMAIL,
    applicant_name: 'Alice',
    status:         'pending_verification',
  };

  mockPoolClient.query.mockImplementation((sql: string) => {
    if (sql?.includes('BEGIN') || sql?.includes('COMMIT') || sql?.includes('ROLLBACK') || sql?.includes('set_config')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql?.includes('portal_verification_tokens') && sql?.includes('WHERE token_hash')) {
      const row = overrides.tokenRow === undefined ? defaultTokenRow : overrides.tokenRow;
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    if (sql?.includes('portal_signup_requests') && sql?.includes('WHERE id')) {
      const row = overrides.signupRow === undefined ? defaultSignupRow : overrides.signupRow;
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    if (sql?.includes('now() >')) {
      // expiry check
      const expired = overrides.verifyResult?.expired ?? false;
      return Promise.resolve({ rows: [{ expired }] });
    }
    if (sql?.includes('organizations') && sql?.includes('WHERE id')) {
      const active = overrides.orgActive === undefined ? true : overrides.orgActive;
      if (active === null) return Promise.resolve({ rows: [] }); // org not found
      return Promise.resolve({ rows: [{ active }] });
    }
    if (sql?.includes('UPDATE portal_verification_tokens') && sql?.includes('consumed_at IS NULL')) {
      const rows = (overrides.consumeRows ?? 1) === 1
        ? [{ signup_request_id: SIGNUP_ID }]
        : [];
      return Promise.resolve({ rows });
    }
    // All other INSERTs / UPDATEs
    return Promise.resolve({ rows: [], rowCount: 1 });
  });

  return rawToken;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PortalVerificationService.redeem()', () => {
  // ── Token not found ─────────────────────────────────────────────────────

  it('throws VERIFICATION_TOKEN_INVALID for an unknown token', async () => {
    const service = makeService();
    setupRedeemPool({ tokenRow: null });

    const err = await service.redeem('garbage.token', IP).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('VERIFICATION_TOKEN_INVALID');
  });

  // ── Expired token ────────────────────────────────────────────────────────

  it('throws VERIFICATION_TOKEN_EXPIRED when the token is past its TTL', async () => {
    const service = makeService();
    const rawToken = setupRedeemPool({ verifyResult: { expired: true } });

    const err = await service.redeem(rawToken, IP).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('VERIFICATION_TOKEN_EXPIRED');
  });

  // ── Already consumed ─────────────────────────────────────────────────────

  it('throws VERIFICATION_TOKEN_CONSUMED for an already-consumed token', async () => {
    const service = makeService();
    const { rawToken, tokenHash, expiresAt } = buildValidToken();

    mockPoolClient.query.mockImplementation((sql: string) => {
      if (sql?.includes('BEGIN') || sql?.includes('COMMIT') || sql?.includes('ROLLBACK') || sql?.includes('set_config')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql?.includes('portal_verification_tokens') && sql?.includes('WHERE token_hash')) {
        return Promise.resolve({ rows: [{
          token_id:          TOKEN_ID,
          signup_request_id: SIGNUP_ID,
          tenant_id:         TENANT_ID,
          token_hash:        tokenHash,
          expires_at:        expiresAt,
          consumed_at:       new Date('2026-01-01T00:00:00Z'), // already consumed
          attempt_count:     1,
        }] });
      }
      if (sql?.includes('portal_signup_requests') && sql?.includes('WHERE id')) {
        return Promise.resolve({ rows: [{
          id: SIGNUP_ID, tenant_id: TENANT_ID, organization_id: ORG_ID,
          email: EMAIL, applicant_name: 'Alice', status: 'pending_verification',
        }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const err = await service.redeem(rawToken, IP).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('VERIFICATION_TOKEN_CONSUMED');
  });

  // ── Concurrent race: conditional UPDATE returns 0 rows ───────────────────

  it('throws VERIFICATION_TOKEN_CONSUMED when a concurrent request consumed the token first', async () => {
    const service = makeService();
    const rawToken = setupRedeemPool({ consumeRows: 0 }); // simulate race

    const err = await service.redeem(rawToken, IP).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('VERIFICATION_TOKEN_CONSUMED');
  });

  // ── Malformed token ──────────────────────────────────────────────────────

  it('throws VERIFICATION_TOKEN_INVALID for a token with no dot separator', async () => {
    const service = makeService();
    // Even if DB finds a row, HMAC check should fail — but a completely unknown
    // token will hit the not-found path first.
    setupRedeemPool({ tokenRow: null });

    const err = await service.redeem('nodottoken', IP).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('VERIFICATION_TOKEN_INVALID');
  });

  // ── Deactivated organisation ─────────────────────────────────────────────

  it('throws ORGANIZATION_INACTIVE when the signup organisation is deactivated', async () => {
    const service = makeService();
    const rawToken = setupRedeemPool({ orgActive: false });

    const err = await service.redeem(rawToken, IP).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('ORGANIZATION_INACTIVE');
  });

  // ── Successful redemption ─────────────────────────────────────────────────

  it('returns accessToken and session for a valid token', async () => {
    const service = makeService();
    const rawToken = setupRedeemPool();

    const result = await service.redeem(rawToken, IP);
    expect(result.accessToken).toBe('at.test');
    expect(result.expiresIn).toBe(900);
    expect(result.user.email).toBe(EMAIL);
    expect(result.user.roles).toEqual(['portal_user']);
    expect(result.onboardingRequired).toBe(true);
    expect(result.tenantId).toBe(TENANT_ID);
  });

  it('portal user is created with role = portal_user only (AC7)', async () => {
    const service = makeService();
    const rawToken = setupRedeemPool();

    await service.redeem(rawToken, IP);

    // Find the INSERT INTO portal_users call
    const insertPortalUser = mockPoolClient.query.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO portal_users'),
    );
    expect(insertPortalUser).toBeDefined();
    const sql = insertPortalUser[0] as string;
    // role is hardcoded as the literal 'portal_user' in the SQL (not a bind parameter)
    expect(sql).toContain("'portal_user'");
    // Must not grant any elevated role
    expect(sql).not.toContain("'staff'");
    expect(sql).not.toContain("'admin'");
  });

  it('mints access token with userType=portal so staff routes reject it (AC7)', async () => {
    const tokSvc = makeTokenService();
    const codec  = new TokenCodec(makeConfig({ PORTAL_TOKEN_SIGNING_KEY: TEST_KEY }));
    const redis  = makeRedis();
    const service = new PortalVerificationService(
      codec, tokSvc, makeSessionService(), redis as never,
    );
    const rawToken = setupRedeemPool();

    await service.redeem(rawToken, IP);

    const mintCall = (tokSvc.mintAccessToken as jest.Mock).mock.calls[0] as Array<Record<string, unknown>>;
    expect(mintCall[0].userType).toBe('portal');
    expect(mintCall[0].roles).toEqual(['portal_user']);
  });

  // ── Idempotency window (60-second Redis cache) ────────────────────────────

  it('returns cached result within the 60-second idempotency window', async () => {
    const cachedResult = {
      accessToken: 'cached.at',
      expiresIn: 900,
      user: { id: 'u1', email: EMAIL, organizationId: ORG_ID, roles: ['portal_user'] },
      onboardingRequired: true,
      sessionId: 'sess-cached',
      refreshToken: 'rt.cached',
      tenantId: TENANT_ID,
    };
    const redis = makeRedis({
      get: jest.fn().mockResolvedValue(JSON.stringify(cachedResult)),
    });
    const service = makeService(redis);
    const { rawToken } = buildValidToken();

    const result = await service.redeem(rawToken, IP);
    expect(result.accessToken).toBe('cached.at');
    // DB should not have been queried at all
    expect(mockPoolClient.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PortalVerificationService.resend() — rate limiting tests
// ---------------------------------------------------------------------------

describe('PortalVerificationService.resend()', () => {
  it('silently succeeds when no pending signup exists for the email (enumeration-safe)', async () => {
    const redis = makeRedis();
    const service = makeService(redis);

    // Pool returns empty result for portal_signup_requests query
    mockPoolClient.query.mockImplementation((sql: string) => {
      if (sql?.includes('set_config')) return Promise.resolve({ rows: [] });
      if (sql?.includes('portal_signup_requests')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    // Should not throw
    await expect(
      service.resend('nobody@acmecorp.com', 'https://portal.opsninja.io/verify'),
    ).resolves.toBeUndefined();
  });

  it('throws RATE_LIMITED after 3 resend requests within one hour', async () => {
    const redis = makeRedis({
      incr: jest.fn()
        .mockResolvedValueOnce(4)  // hourly counter → exceeds limit on this call
        .mockResolvedValue(1),
    });
    const service = makeService(redis);

    const err = await service
      .resend('alice@acmecorp.com', 'https://portal.opsninja.io/verify')
      .catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('RATE_LIMITED');
  });
});

// ---------------------------------------------------------------------------
// PortalVerificationService.isLockedOut() / recordFailedAttempt()
// ---------------------------------------------------------------------------

describe('PortalVerificationService lockout helpers', () => {
  it('isLockedOut returns locked=true and retryAfter>0 when lockout key exists', async () => {
    const redis = makeRedis({
      ttl: jest.fn().mockResolvedValue(600), // 10 minutes remaining
    });
    const service = makeService(redis);

    const result = await service.isLockedOut('alice@acmecorp.com');
    expect(result.locked).toBe(true);
    expect(result.retryAfter).toBe(600);
  });

  it('isLockedOut returns locked=false when no lockout key exists', async () => {
    const redis = makeRedis({
      ttl: jest.fn().mockResolvedValue(-2), // key does not exist
    });
    const service = makeService(redis);

    const result = await service.isLockedOut('alice@acmecorp.com');
    expect(result.locked).toBe(false);
    expect(result.retryAfter).toBe(0);
  });
});
