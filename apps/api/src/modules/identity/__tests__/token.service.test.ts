/**
 * TokenService unit tests.
 *
 * Covers: issuance, verification, missing claims, expiry boundary, wrong
 * issuer/audience, key rotation (multi-key verify set), stable error codes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  TokenService,
  TokenVerificationError,
  createHs256TokenService,
  deriveSecretKey,
  type AccessTokenClaims,
} from '../token.service.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET = 'test-secret-that-is-long-enough-for-hs256-testing-purposes';
const CLAIMS_BASE: Omit<AccessTokenClaims, 'jti' | 'iat' | 'exp'> = {
  sub:               'user-uuid-001',
  tenant_id:         'tenant-uuid-001',
  roles:             ['support_agent'],
  org_scope_version: 3,
};

// ---------------------------------------------------------------------------
// Basic issuance + verification
// ---------------------------------------------------------------------------

describe('TokenService.issueAccessToken + verifyAccessToken', () => {
  let svc: TokenService;

  beforeAll(() => {
    svc = createHs256TokenService(SECRET);
  });

  it('issues a token and verifies it successfully', async () => {
    const token = await svc.issueAccessToken(CLAIMS_BASE);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const claims = await svc.verifyAccessToken(token);
    expect(claims.sub).toBe(CLAIMS_BASE.sub);
    expect(claims.tenant_id).toBe(CLAIMS_BASE.tenant_id);
    expect(claims.roles).toEqual(CLAIMS_BASE.roles);
    expect(claims.org_scope_version).toBe(CLAIMS_BASE.org_scope_version);
    expect(typeof claims.jti).toBe('string');
    expect(claims.jti.length).toBeGreaterThan(0);
  });

  it('issues two tokens with distinct jti values', async () => {
    const t1 = await svc.issueAccessToken(CLAIMS_BASE);
    const t2 = await svc.issueAccessToken(CLAIMS_BASE);
    const c1 = await svc.verifyAccessToken(t1);
    const c2 = await svc.verifyAccessToken(t2);
    expect(c1.jti).not.toBe(c2.jti);
  });

  it('embeds iat and exp claims', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await svc.issueAccessToken(CLAIMS_BASE);
    const claims = await svc.verifyAccessToken(token);
    const after = Math.floor(Date.now() / 1000);

    expect(claims.iat).toBeGreaterThanOrEqual(before);
    expect(claims.iat).toBeLessThanOrEqual(after);
    expect(claims.exp).toBeGreaterThan(claims.iat);
    expect(claims.exp - claims.iat).toBe(900); // default TTL
  });

  it('respects custom TTL', async () => {
    const shortSvc = createHs256TokenService(SECRET, { accessTokenTtlSeconds: 60 });
    const token = await shortSvc.issueAccessToken(CLAIMS_BASE);
    const claims = await shortSvc.verifyAccessToken(token);
    expect(claims.exp - claims.iat).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Clock injection — expiry boundary
// ---------------------------------------------------------------------------

describe('TokenService expiry boundary with injected clock', () => {
  it('rejects an expired token', async () => {
    const nowMs = Date.now();
    // Issue with a clock in the past so the token is already expired
    const pastSvc = new TokenService({
      signingKey: deriveSecretKey(SECRET),
      algorithm: 'HS256',
      accessTokenTtlSeconds: 1,
      clock: () => nowMs - 10_000, // 10 s in the past
      clockSkewSeconds: 0,
    });

    const token = await pastSvc.issueAccessToken(CLAIMS_BASE);

    // Verify with a real-time service (no skew)
    const verifySvc = new TokenService({
      signingKey: deriveSecretKey(SECRET),
      algorithm: 'HS256',
      clockSkewSeconds: 0,
    });

    await expect(verifySvc.verifyAccessToken(token)).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });

  it('accepts a token within clock-skew tolerance', async () => {
    const nowMs = Date.now();
    const pastSvc = new TokenService({
      signingKey: deriveSecretKey(SECRET),
      algorithm: 'HS256',
      accessTokenTtlSeconds: 1,
      clock: () => nowMs - 2_000, // 2 s in the past → exp 1 s ago
      clockSkewSeconds: 0,
    });
    const token = await pastSvc.issueAccessToken(CLAIMS_BASE);

    // Verify with 30 s skew tolerance — should succeed
    const verifySvc = new TokenService({
      signingKey: deriveSecretKey(SECRET),
      algorithm: 'HS256',
      clockSkewSeconds: 30,
    });

    const claims = await verifySvc.verifyAccessToken(token);
    expect(claims.sub).toBe(CLAIMS_BASE.sub);
  });
});

// ---------------------------------------------------------------------------
// Issuer and audience
// ---------------------------------------------------------------------------

describe('TokenService issuer / audience validation', () => {
  it('rejects a token with wrong issuer', async () => {
    const issueSvc = createHs256TokenService(SECRET, { issuer: 'https://issuer-a.example' });
    const verifySvc = createHs256TokenService(SECRET, { issuer: 'https://issuer-b.example' });

    const token = await issueSvc.issueAccessToken(CLAIMS_BASE);
    await expect(verifySvc.verifyAccessToken(token)).rejects.toMatchObject({
      code: 'TOKEN_ISSUER_UNTRUSTED',
    });
  });

  it('accepts a token when issuer matches', async () => {
    const iss = 'https://correct-issuer.example';
    const svc = createHs256TokenService(SECRET, { issuer: iss });
    const token = await svc.issueAccessToken(CLAIMS_BASE);
    const claims = await svc.verifyAccessToken(token);
    expect(claims.sub).toBe(CLAIMS_BASE.sub);
  });
});

// ---------------------------------------------------------------------------
// Key rotation — multi-key verification set
// ---------------------------------------------------------------------------

describe('TokenService key rotation', () => {
  it('verifies tokens signed with a previous key when it is in the verification set', async () => {
    const oldKey = deriveSecretKey('old-secret-key');
    const newKey = deriveSecretKey('new-secret-key');

    const oldSvc = new TokenService({ signingKey: oldKey, algorithm: 'HS256' });
    const tokenSignedWithOld = await oldSvc.issueAccessToken(CLAIMS_BASE);

    // New service: new signing key + old key in verification set
    const newSvc = new TokenService({
      signingKey: newKey,
      algorithm: 'HS256',
      verificationKeys: [oldKey],
    });

    // Should still verify the old-key token
    const claims = await newSvc.verifyAccessToken(tokenSignedWithOld);
    expect(claims.sub).toBe(CLAIMS_BASE.sub);

    // Also verify a new-key token
    const newToken = await newSvc.issueAccessToken(CLAIMS_BASE);
    const newClaims = await newSvc.verifyAccessToken(newToken);
    expect(newClaims.sub).toBe(CLAIMS_BASE.sub);
  });

  it('rejects a token when none of the keys match', async () => {
    const unknownKey = deriveSecretKey('completely-different-key');
    const svc = createHs256TokenService(SECRET);
    const token = await (new TokenService({ signingKey: unknownKey })).issueAccessToken(CLAIMS_BASE);

    await expect(svc.verifyAccessToken(token)).rejects.toMatchObject({
      code: 'TOKEN_MALFORMED',
    });
  });
});

// ---------------------------------------------------------------------------
// Missing claims
// ---------------------------------------------------------------------------

describe('TokenService missing claims detection', () => {
  it('rejects a token where roles is missing (manually built)', async () => {
    const { SignJWT } = await import('jose');
    const key = deriveSecretKey(SECRET);
    // Build a token without the roles claim
    const badToken = await new SignJWT({
      sub: 'u1',
      tenant_id: 't1',
      // roles MISSING
      org_scope_version: 1,
      jti: 'abc',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key);

    const svc = new TokenService({ signingKey: key, algorithm: 'HS256' });
    await expect(svc.verifyAccessToken(badToken)).rejects.toMatchObject({
      code: 'TOKEN_MISSING_CLAIMS',
    });
  });
});

// ---------------------------------------------------------------------------
// Missing token
// ---------------------------------------------------------------------------

describe('TokenService missing token', () => {
  it('returns TOKEN_MISSING for empty string', async () => {
    const svc = createHs256TokenService(SECRET);
    await expect(svc.verifyAccessToken('')).rejects.toMatchObject({
      code: 'TOKEN_MISSING',
    });
  });

  it('returns TOKEN_MALFORMED for a random non-JWT string', async () => {
    const svc = createHs256TokenService(SECRET);
    await expect(svc.verifyAccessToken('not.a.jwt')).rejects.toMatchObject({
      code: 'TOKEN_MALFORMED',
    });
  });
});

// ---------------------------------------------------------------------------
// deriveSecretKey
// ---------------------------------------------------------------------------

describe('deriveSecretKey', () => {
  it('returns a 32-byte Uint8Array', () => {
    const key = deriveSecretKey('any-secret');
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('is deterministic for the same input', () => {
    const k1 = deriveSecretKey('hello');
    const k2 = deriveSecretKey('hello');
    expect(Buffer.from(k1).toString('hex')).toBe(Buffer.from(k2).toString('hex'));
  });

  it('produces different keys for different inputs', () => {
    const k1 = deriveSecretKey('secret-a');
    const k2 = deriveSecretKey('secret-b');
    expect(Buffer.from(k1).toString('hex')).not.toBe(Buffer.from(k2).toString('hex'));
  });
});
