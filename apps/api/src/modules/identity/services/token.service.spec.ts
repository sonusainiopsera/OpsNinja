/**
 * Unit tests for TokenService.
 *
 * Tests cover:
 *  - Access token claim shape and field values
 *  - expiry computation (nowMs injection)
 *  - RS256 algorithm and kid header
 *  - Verify roundtrip
 *  - JWKS export format
 *  - Missing key graceful warning (logged, not thrown)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { TokenService, ACCESS_TOKEN_TTL_SECONDS } from './token.service';
import {
  tokenServiceTestEnv,
  buildMintInput,
  TEST_KID,
  TEST_ISSUER,
  TEST_AUDIENCE,
} from '../../../../test/fixtures/session.fixtures';
import { TENANT_A_ID, TENANT_A_STAFF_USER_ID } from '../../../../test/factories/principal-context.factory';

// Decode JWT without verifying for header/payload inspection
function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [h, p] = token.split('.');
  const decode = (b64: string) => JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as Record<string, unknown>;
  return { header: decode(h), payload: decode(p) };
}

describe('TokenService', () => {
  let service: TokenService;

  const env = tokenServiceTestEnv();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => env],
        }),
      ],
      providers: [TokenService],
    }).compile();

    service = module.get(TokenService);
  });

  // ---------------------------------------------------------------------------
  // mintAccessToken — claim shape
  // ---------------------------------------------------------------------------

  describe('mintAccessToken', () => {
    it('returns a token string with expiresIn=900 and a valid Date', () => {
      const input = buildMintInput();
      const result = service.mintAccessToken(input);

      expect(typeof result.accessToken).toBe('string');
      expect(result.expiresIn).toBe(900);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(typeof result.jti).toBe('string');
    });

    it('embeds correct claims in JWT payload', () => {
      const nowMs = 1_700_000_000_000;
      const input = buildMintInput({ roles: ['admin', 'agent'] });
      const result = service.mintAccessToken(input, nowMs);

      const { payload } = decodeJwt(result.accessToken);

      expect(payload['sub']).toBe(TENANT_A_STAFF_USER_ID);
      expect(payload['tenant_id']).toBe(TENANT_A_ID);
      expect(payload['roles']).toEqual(['admin', 'agent']);
      expect(payload['org_scope_version']).toBe(1);
      expect(payload['user_type']).toBe('staff');
      expect(payload['iss']).toBe(TEST_ISSUER);
      expect(payload['aud']).toBe(TEST_AUDIENCE);
      expect(typeof payload['jti']).toBe('string');
    });

    it('uses RS256 algorithm and correct kid in JWT header', () => {
      const result = service.mintAccessToken(buildMintInput());
      const { header } = decodeJwt(result.accessToken);
      expect(header['alg']).toBe('RS256');
      expect(header['kid']).toBe(TEST_KID);
    });

    it('expiresAt is approximately 900 seconds from nowMs', () => {
      const nowMs = 1_700_000_000_000;
      const result = service.mintAccessToken(buildMintInput(), nowMs);
      const expectedMs = (Math.floor(nowMs / 1000) + ACCESS_TOKEN_TTL_SECONDS) * 1000;
      expect(result.expiresAt.getTime()).toBe(expectedMs);
    });

    it('generates unique jti for each mint', () => {
      const input = buildMintInput();
      const a = service.mintAccessToken(input);
      const b = service.mintAccessToken(input);
      expect(a.jti).not.toBe(b.jti);
    });
  });

  // ---------------------------------------------------------------------------
  // verifyAccessToken — roundtrip
  // ---------------------------------------------------------------------------

  describe('verifyAccessToken', () => {
    it('verifies a minted token and returns the same claims', () => {
      const input = buildMintInput({ roles: ['agent'] });
      const { accessToken } = service.mintAccessToken(input);
      const claims = service.verifyAccessToken(accessToken);

      expect(claims.sub).toBe(TENANT_A_STAFF_USER_ID);
      expect(claims.tenant_id).toBe(TENANT_A_ID);
      expect(claims.roles).toEqual(['agent']);
      expect(claims.user_type).toBe('staff');
      expect(claims.iss).toBe(TEST_ISSUER);
    });

    it('throws on tampered token', () => {
      const { accessToken } = service.mintAccessToken(buildMintInput());
      const [h, p, s] = accessToken.split('.');
      const tampered = `${h}.${p}tampered.${s}`;
      expect(() => service.verifyAccessToken(tampered)).toThrow();
    });

    it('throws on token signed with a different key', () => {
      // Mint with test service; create another service with different keys and verify
      const { privateKey, publicKey } = require('crypto').generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const altEnv = {
        ...env,
        AUTH_PRIVATE_KEY: privateKey as string,
        AUTH_PUBLIC_KEY: publicKey as string,
      };

      const altService = new TokenService({
        get: <T>(key: string, def?: T): T => (altEnv[key as keyof typeof altEnv] as unknown as T) ?? def as T,
      } as ConfigService);

      const { accessToken } = altService.mintAccessToken(buildMintInput());
      // Original service public key won't verify alt service's token
      expect(() => service.verifyAccessToken(accessToken)).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // getPublicJwks
  // ---------------------------------------------------------------------------

  describe('getPublicJwks', () => {
    it('returns a JWKS with one key, correct use/alg/kid', () => {
      const jwks = service.getPublicJwks();
      expect(jwks.keys).toHaveLength(1);
      const key = jwks.keys[0] as Record<string, unknown>;
      expect(key['use']).toBe('sig');
      expect(key['alg']).toBe('RS256');
      expect(key['kid']).toBe(TEST_KID);
      expect(key['kty']).toBe('RSA');
      expect(typeof key['n']).toBe('string');
      expect(typeof key['e']).toBe('string');
    });

    it('returns empty keys array when public key is not configured', async () => {
      const noKeyModule = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true, load: [() => ({})] }),
        ],
        providers: [TokenService],
      }).compile();

      const noKeyService = noKeyModule.get(TokenService);
      const jwks = noKeyService.getPublicJwks();
      expect(jwks.keys).toHaveLength(0);
    });
  });
});
