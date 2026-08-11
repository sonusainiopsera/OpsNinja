/**
 * Shared RBAC test fixtures.
 *
 * Provides pre-signed access tokens and role-permission matrix data for all
 * six seeded roles so guard and integration test suites run with no external
 * services.
 */

import * as jwt from 'jsonwebtoken';
import { generateTestKeyPair } from './session.fixtures';
import { TENANT_A_ID } from '../factories/principal.factory';
import { ROLE_PERMISSION_MAP } from '../../src/common/auth/permissions';
import { TokenService } from '../../src/modules/identity/token.service';

export { TENANT_A_ID };

// ── Shared test keypair (generated once per test suite) ───────────────────────

export const TEST_KEY_PAIR = generateTestKeyPair('rbac-test-key-1');

// ── Well-known test values ────────────────────────────────────────────────────

export const TEST_ISSUER = 'https://test.opsninja.io';
export const STAFF_AUDIENCE = 'opsninja';
export const PORTAL_AUDIENCE = 'opsninja-portal';
export const MACHINE_AUDIENCE = 'opsninja-machine';

/** Six seeded roles with their canonical test user IDs. */
export const ROLE_FIXTURES = {
  admin:       { userId: '00000000-0000-0000-aaaa-000000000001', roles: ['admin']       },
  supervisor:  { userId: '00000000-0000-0000-aaaa-000000000002', roles: ['supervisor']  },
  agent:       { userId: '00000000-0000-0000-aaaa-000000000003', roles: ['agent']       },
  readonly:    { userId: '00000000-0000-0000-aaaa-000000000004', roles: ['readonly']    },
  portal_user: { userId: '00000000-0000-0000-aaaa-000000000005', roles: ['portal_user'] },
  worker:      { userId: '00000000-0000-0000-aaaa-000000000006', roles: ['worker']      },
} as const;

export type SeededRole = keyof typeof ROLE_FIXTURES;

// ── Role–permission matrix ────────────────────────────────────────────────────

export const ROLE_PERMISSION_MATRIX = ROLE_PERMISSION_MAP;

// ── Token factories ───────────────────────────────────────────────────────────

interface MintOpts {
  userId?: string;
  tenantId?: string;
  roles?: string[];
  audience?: string;
  expiresIn?: number;
  iat?: number;
}

export function mintTestToken(opts: MintOpts = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const {
    userId = '00000000-0000-0000-0000-000000000099',
    tenantId = TENANT_A_ID,
    roles = ['agent'],
    audience = STAFF_AUDIENCE,
    expiresIn = 900,
    iat = now,
  } = opts;

  return jwt.sign(
    {
      sub: userId,
      tenant_id: tenantId,
      roles,
      org_scope_version: 0,
      user_type: audience === MACHINE_AUDIENCE ? 'machine' : audience === PORTAL_AUDIENCE ? 'portal' : 'staff',
      jti: `test-jti-${userId}`,
      iat,
      exp: iat + expiresIn,
      iss: TEST_ISSUER,
      aud: audience,
    },
    TEST_KEY_PAIR.privateKey,
    { algorithm: 'RS256', keyid: TEST_KEY_PAIR.kid, noTimestamp: true },
  );
}

/** Pre-signed tokens for each seeded role (staff audience, valid for ~1 hour). */
export const ROLE_TOKENS: Record<SeededRole, string> = {
  admin:       mintTestToken({ ...ROLE_FIXTURES.admin,       audience: STAFF_AUDIENCE  }),
  supervisor:  mintTestToken({ ...ROLE_FIXTURES.supervisor,  audience: STAFF_AUDIENCE  }),
  agent:       mintTestToken({ ...ROLE_FIXTURES.agent,       audience: STAFF_AUDIENCE  }),
  readonly:    mintTestToken({ ...ROLE_FIXTURES.readonly,    audience: STAFF_AUDIENCE  }),
  portal_user: mintTestToken({ ...ROLE_FIXTURES.portal_user, audience: PORTAL_AUDIENCE }),
  worker:      mintTestToken({ ...ROLE_FIXTURES.worker,      audience: MACHINE_AUDIENCE }),
};

/** An expired token for testing 401 AUTH_TOKEN_EXPIRED behaviour. */
export const EXPIRED_TOKEN = mintTestToken({
  userId: '00000000-0000-0000-0000-000000000099',
  roles: ['agent'],
  iat: Math.floor(Date.now() / 1000) - 3600,
  expiresIn: 900, // exp = iat+900 = 2700s ago
});

/** A token signed with a different (unknown) key for testing AUTH_TOKEN_INVALID. */
export const INVALID_SIGNATURE_TOKEN = (() => {
  const { privateKey } = generateTestKeyPair('unknown-key');
  return jwt.sign(
    { sub: 'u', tenant_id: TENANT_A_ID, roles: ['agent'], aud: STAFF_AUDIENCE, iss: TEST_ISSUER },
    privateKey,
    { algorithm: 'RS256', expiresIn: 900 },
  );
})();

// ── Fake services for guard unit tests ───────────────────────────────────────

export function makeFakeAuditService() {
  return { recordAccessDenial: jest.fn().mockResolvedValue(undefined) };
}

export function makeFakePermissionResolver(permissions: string[] = []) {
  return { resolvePermissions: jest.fn().mockResolvedValue(new Set(permissions)) };
}

export function makeFakeTokenServiceFromKeyPair() {
  const svc = new TokenService({
    get: (key: string, def?: unknown) => {
      const m: Record<string, unknown> = {
        JWT_PRIVATE_KEY: TEST_KEY_PAIR.privateKey,
        JWT_PUBLIC_KEY:  TEST_KEY_PAIR.publicKey,
        JWT_KID:         TEST_KEY_PAIR.kid,
        JWT_ISSUER:      TEST_ISSUER,
        JWT_AUDIENCE:    STAFF_AUDIENCE,
      };
      return m[key] ?? def;
    },
  } as never);
  return svc;
}
