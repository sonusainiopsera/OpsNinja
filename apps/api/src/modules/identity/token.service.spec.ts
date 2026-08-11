/**
 * Unit tests for TokenService.
 *
 * Uses jest fake timers and an injected RSA keypair so tests never depend on
 * real time or live secrets.  All system-clock manipulation goes through
 * jest.setSystemTime() so jsonwebtoken's internal Date.now() calls stay
 * consistent with our fake token timestamps.
 */

import { ConfigService } from '@nestjs/config';
import { TokenService, MintTokenInput } from './token.service';
import { generateTestKeyPair } from '../../../test/fixtures/session.fixtures';

// ── Fake clock ───────────────────────────────────────────────────────────────

const FIXED_NOW_MS = 1_700_000_000_000;

class TestableTokenService extends TokenService {
  private _nowMs = FIXED_NOW_MS;
  setNow(ms: number) {
    this._nowMs = ms;
    jest.setSystemTime(new Date(ms));
  }
  protected override now() { return this._nowMs; }
}

// ── Test keypair ─────────────────────────────────────────────────────────────

const { privateKey, publicKey, kid } = generateTestKeyPair('test-key-1');

function makeConfig(extra: Record<string, string> = {}): ConfigService {
  const cfg: Record<string, string> = {
    JWT_PRIVATE_KEY: privateKey,
    JWT_PUBLIC_KEY: publicKey,
    JWT_KID: kid,
    JWT_ISSUER: 'https://test.opsninja.io',
    JWT_AUDIENCE: 'test-audience',
    ...extra,
  };
  return {
    get: jest.fn().mockImplementation((key: string, def?: unknown) => cfg[key] ?? def),
  } as unknown as ConfigService;
}

const SAMPLE_INPUT: MintTokenInput = {
  userId: '00000000-0000-0000-0000-100000000001',
  tenantId: '00000000-0000-0000-0000-000000000001',
  roles: ['agent'],
  principalKind: 'staff',
  orgScopeVersion: 7,
};

// ── Suite ────────────────────────────────────────────────────────────────────

describe('TokenService', () => {
  let svc: TestableTokenService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(FIXED_NOW_MS));
    svc = new TestableTokenService(makeConfig());
    svc.setNow(FIXED_NOW_MS);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Claim shape (AC1) ──────────────────────────────────────────────────────
  it('mints an access token containing all required claims', () => {
    const { accessToken } = svc.mintAccessToken(SAMPLE_INPUT);
    const decoded = svc.verifyAccessToken(accessToken);

    expect(decoded.sub).toBe(SAMPLE_INPUT.userId);
    expect(decoded.tenant_id).toBe(SAMPLE_INPUT.tenantId);
    expect(decoded.roles).toEqual(SAMPLE_INPUT.roles);
    expect(decoded.org_scope_version).toBe(SAMPLE_INPUT.orgScopeVersion);
    expect(decoded.user_type).toBe(SAMPLE_INPUT.principalKind);
    expect(typeof decoded.jti).toBe('string');
    expect(decoded.iss).toBe('https://test.opsninja.io');
    expect(decoded.aud).toBe('test-audience');
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
  });

  // ── Expiry = exactly 15 minutes (AC1) ─────────────────────────────────────
  it('sets exp = iat + 900 seconds (15 min)', () => {
    const { accessToken } = svc.mintAccessToken(SAMPLE_INPUT);
    const decoded = svc.verifyAccessToken(accessToken);
    expect(decoded.exp - decoded.iat).toBe(900);
  });

  it('token is valid at 14:59 and invalid at 15:01', () => {
    const { accessToken } = svc.mintAccessToken(SAMPLE_INPUT);

    // Still valid 899 seconds after issuance
    svc.setNow(FIXED_NOW_MS + 899_000);
    expect(() => svc.verifyAccessToken(accessToken)).not.toThrow();

    // Expired 901 seconds after issuance
    svc.setNow(FIXED_NOW_MS + 901_000);
    expect(() => svc.verifyAccessToken(accessToken)).toThrow();
  });

  it('ignoreExpiration flag allows verifying an expired token', () => {
    const { accessToken } = svc.mintAccessToken(SAMPLE_INPUT);
    svc.setNow(FIXED_NOW_MS + 3_600_000); // 1 hour later
    expect(() => svc.verifyAccessToken(accessToken, { ignoreExpiration: true })).not.toThrow();
  });

  // ── kid in header (AC1) ───────────────────────────────────────────────────
  it('includes the configured kid in the JWT header', () => {
    const { accessToken } = svc.mintAccessToken(SAMPLE_INPUT);
    const [headerB64] = accessToken.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString()) as { kid: string };
    expect(header.kid).toBe(kid);
  });

  it('uses RS256 algorithm', () => {
    const { accessToken } = svc.mintAccessToken(SAMPLE_INPUT);
    const [headerB64] = accessToken.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString()) as { alg: string };
    expect(header.alg).toBe('RS256');
  });

  // ── Wrong key rejected ─────────────────────────────────────────────────────
  it('rejects a token signed with a different key', () => {
    const other = generateTestKeyPair('other-key');
    const otherSvc = new TestableTokenService(
      makeConfig({
        JWT_PRIVATE_KEY: other.privateKey,
        JWT_PUBLIC_KEY: other.publicKey,
        JWT_KID: other.kid,
      }),
    );
    const { accessToken } = otherSvc.mintAccessToken(SAMPLE_INPUT);
    expect(() => svc.verifyAccessToken(accessToken)).toThrow();
  });

  // ── Key rotation: previous key stays verifiable ────────────────────────────
  it('accepts tokens signed with the previous (rotated-out) key', () => {
    const oldPair = generateTestKeyPair('key-0');
    const oldSvc = new TestableTokenService(
      makeConfig({
        JWT_PRIVATE_KEY: oldPair.privateKey,
        JWT_PUBLIC_KEY: oldPair.publicKey,
        JWT_KID: 'key-0',
      }),
    );
    const { accessToken } = oldSvc.mintAccessToken(SAMPLE_INPUT);

    const newSvc = new TestableTokenService(
      makeConfig({ JWT_PREV_PUBLIC_KEY: oldPair.publicKey, JWT_PREV_KID: 'key-0' }),
    );
    expect(() => newSvc.verifyAccessToken(accessToken)).not.toThrow();
  });

  // ── jti is unique per token ────────────────────────────────────────────────
  it('generates a unique jti for each minted token', () => {
    const { jti: jti1 } = svc.mintAccessToken(SAMPLE_INPUT);
    const { jti: jti2 } = svc.mintAccessToken(SAMPLE_INPUT);
    expect(jti1).not.toBe(jti2);
  });

  // ── expiresIn constant ─────────────────────────────────────────────────────
  it('returns expiresIn = 900', () => {
    const { expiresIn } = svc.mintAccessToken(SAMPLE_INPUT);
    expect(expiresIn).toBe(900);
  });

  // ── Missing key config throws at mint time ─────────────────────────────────
  it('throws when JWT_PRIVATE_KEY is not configured', () => {
    const emptySvc = new TestableTokenService(
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    );
    expect(() => emptySvc.mintAccessToken(SAMPLE_INPUT)).toThrow('JWT_PRIVATE_KEY');
  });

  // ── org_scope_version defaults to 0 ───────────────────────────────────────
  it('defaults org_scope_version to 0 when not provided', () => {
    const { accessToken } = svc.mintAccessToken({ ...SAMPLE_INPUT, orgScopeVersion: undefined });
    const decoded = svc.verifyAccessToken(accessToken);
    expect(decoded.org_scope_version).toBe(0);
  });
});
