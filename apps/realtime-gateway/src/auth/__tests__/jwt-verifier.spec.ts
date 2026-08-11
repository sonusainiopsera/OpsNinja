/**
 * Unit tests for JwtVerifier.
 *
 * Uses a locally-generated RSA key pair so no real KMS/JWKS calls are made.
 * The key pair is generated once at test startup to keep test runs fast.
 */

import { generateKeyPairSync } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { JwtVerifier } from '../jwt-verifier';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const TENANT_A = 'tenant-aaaa';
const USER_ID  = 'user-1234';
const AUD      = 'opsninja';
const ISS      = 'https://api.opsninja.io';

function mintToken(
  overrides: Partial<{
    sub: string;
    tenant_id: string;
    roles: string[];
    org_scope_version: number;
    org_scope_ids: string[];
    user_type: string;
    aud: string;
    expiresIn: number;
  }> = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: overrides.sub ?? USER_ID,
      tenant_id: overrides.tenant_id ?? TENANT_A,
      roles: overrides.roles ?? ['agent'],
      org_scope_version: overrides.org_scope_version ?? 1,
      org_scope_ids: overrides.org_scope_ids ?? ['org-1'],
      user_type: overrides.user_type ?? 'staff',
      jti: 'jti-test-001',
      iat: now,
      exp: now + (overrides.expiresIn ?? 900),
      iss: ISS,
    },
    privateKey,
    { algorithm: 'RS256', audience: overrides.aud ?? AUD },
  );
}

function makeVerifier(): JwtVerifier {
  const config = {
    get: (key: string, fallback?: string) => {
      if (key === 'JWT_PUBLIC_KEY') return publicKey;
      if (key === 'JWT_AUDIENCE')   return AUD;
      return fallback ?? '';
    },
  };
  return new JwtVerifier(config as any);
}

describe('JwtVerifier', () => {
  it('verifies a valid token and returns principal', () => {
    const token = mintToken({ org_scope_ids: ['org-a', 'org-b'] });
    const verifier = makeVerifier();
    const principal = verifier.verify(token);

    expect(principal.principalId).toBe(USER_ID);
    expect(principal.tenantId).toBe(TENANT_A);
    expect(principal.roles).toEqual(['agent']);
    expect(principal.orgScopeVersion).toBe(1);
    expect(principal.orgScopeIds.has('org-a')).toBe(true);
    expect(principal.orgScopeIds.has('org-b')).toBe(true);
    expect(principal.orgScopeIds.has('org-c')).toBe(false);
  });

  it('returns orgScopeIds as a Set', () => {
    const token = mintToken({ org_scope_ids: ['org-1', 'org-2'] });
    const verifier = makeVerifier();
    const principal = verifier.verify(token);
    expect(principal.orgScopeIds).toBeInstanceOf(Set);
  });

  it('defaults orgScopeIds to empty Set when claim is absent', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        sub: USER_ID,
        tenant_id: TENANT_A,
        roles: ['manager'],
        org_scope_version: 0,
        user_type: 'staff',
        jti: 'jti-2',
        iat: now,
        exp: now + 900,
        iss: ISS,
      },
      privateKey,
      { algorithm: 'RS256', audience: AUD },
    );
    const verifier = makeVerifier();
    const principal = verifier.verify(token);
    expect(principal.orgScopeIds.size).toBe(0);
  });

  it('throws on an expired token', () => {
    const token = mintToken({ expiresIn: -1 });
    const verifier = makeVerifier();
    expect(() => verifier.verify(token)).toThrow();
  });

  it('isExpired returns true for expired token', () => {
    const token = mintToken({ expiresIn: -1 });
    const verifier = makeVerifier();
    expect(verifier.isExpired(token)).toBe(true);
  });

  it('isExpired returns false for valid token', () => {
    const token = mintToken();
    const verifier = makeVerifier();
    expect(verifier.isExpired(token)).toBe(false);
  });

  it('throws on wrong audience', () => {
    const token = mintToken({ aud: 'other-service' });
    const verifier = makeVerifier();
    expect(() => verifier.verify(token)).toThrow();
  });

  it('throws when public key is empty', () => {
    const config = { get: (_key: string, fallback?: string) => fallback ?? '' };
    const verifier = new JwtVerifier(config as any);
    const token = mintToken();
    expect(() => verifier.verify(token)).toThrow('JWT_PUBLIC_KEY not configured');
  });

  it('throws on tampered token', () => {
    const token = mintToken();
    const [header, , signature] = token.split('.');
    const fakePayload = Buffer.from(JSON.stringify({ sub: 'attacker' })).toString('base64url');
    const tampered = `${header}.${fakePayload}.${signature}`;
    const verifier = makeVerifier();
    expect(() => verifier.verify(tampered)).toThrow();
  });
});
