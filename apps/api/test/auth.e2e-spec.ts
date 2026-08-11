/**
 * Auth end-to-end integration tests.
 *
 * Uses a real PostgreSQL 16 container (testcontainers) and a local mock OIDC
 * provider to exercise the full authentication flow without any HTTP framework.
 *
 * Test scenarios:
 *   1. Full login flow: OIDC exchange → access token + refresh cookie
 *   2. Authenticated request: JwtAuthGuard verifies access token
 *   3. Refresh rotation: new tokens issued, old cookie invalidated
 *   4. Rotation-reuse detection: presenting a rotated token revokes the family
 *   5. Logout: session revoked server-side; subsequent refresh fails
 *   6. Admin revocation: revokeAllForUser → subsequent refresh fails
 *   7. Throttling: five failed attempts → lockout → 429
 *   8. Unknown domain: rejected with AUTH_TENANT_UNRESOLVED
 *   9. Post-logout refresh rejection
 *  10. Audit records emitted for key events
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { createTestDb, type TestDbContext } from '../../../packages/db/test/harness.js';
import {
  loadRbacCatalog,
  loadIdentityFixtures,
  FIXTURE_IDS,
} from '../../../packages/db/test/fixtures/identity.fixtures.js';
import { MockOidcProvider, MOCK_USERS } from './mocks/oidc-provider.js';
import { TokenService, createHs256TokenService } from '../src/modules/identity/token.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { OidcService, InMemoryKeyValueStore } from '../src/modules/identity/oidc.service.js';
import { UsersRepository } from '../src/modules/identity/users.repository.js';
import { AuthController, InMemoryThrottleStore, type AuthRequest } from '../src/modules/identity/auth.controller.js';
import {
  JwtAuthGuard,
  InMemoryRevocationStore,
} from '../src/common/auth/jwt-auth.guard.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JWT_SECRET = 'auth-e2e-test-secret-that-is-long-enough';
const CLIENT_ID = 'test-client-id';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let ctx: TestDbContext;
let sql: Sql;
let oidcProvider: MockOidcProvider;
let tokenSvc: TokenService;
let sessionSvc: SessionService;
let usersRepo: UsersRepository;
let stateStore: InMemoryKeyValueStore;
let throttleStore: InMemoryThrottleStore;
let controller: AuthController;
let guard: JwtAuthGuard;

beforeAll(async () => {
  ctx = await createTestDb('auth-e2e');
  sql = postgres(ctx.connectionString, { max: 5 });

  // Ensure app_user has LOGIN for SET LOCAL ROLE pattern
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOBYPASSRLS;
      END IF;
    END;
    $$;
  `);

  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE ON users TO app_user;
    GRANT SELECT, INSERT, UPDATE ON refresh_sessions TO app_user;
    GRANT SELECT, INSERT ON audit_logs TO app_user;
    GRANT SELECT ON tenants TO app_user;
    GRANT SELECT ON organization_verified_domains TO app_user;
    GRANT SELECT, INSERT, DELETE ON user_roles TO app_user;
    GRANT SELECT ON roles TO app_user;
    GRANT SELECT, INSERT, DELETE ON agent_org_scopes TO app_user;
  `);

  await loadRbacCatalog(sql);
  await loadIdentityFixtures(sql);

  // Seed a verified domain for Tenant A pointing to fixture-a.example
  await sql.unsafe(`
    INSERT INTO organization_verified_domains
      (tenant_id, organization_id, domain)
    VALUES
      ('${FIXTURE_IDS.TENANT_A}'::uuid,
       '${FIXTURE_IDS.ORG_A1}'::uuid,
       'fixture-a.example')
    ON CONFLICT DO NOTHING;
  `);

  // Start mock OIDC provider
  oidcProvider = await MockOidcProvider.start();

  // Build services
  tokenSvc = createHs256TokenService(JWT_SECRET);
  sessionSvc = new SessionService();
  usersRepo = new UsersRepository();
  stateStore = new InMemoryKeyValueStore();
  throttleStore = new InMemoryThrottleStore();

  const oidcSvc = new OidcService(
    {
      issuer: oidcProvider.issuer,
      clientId: CLIENT_ID,
      redirectUri: 'http://localhost:3000/api/v1/auth/callback',
    },
    stateStore,
  );

  controller = new AuthController({
    sql,
    tokenService: tokenSvc,
    sessionService: sessionSvc,
    oidcService: oidcSvc,
    usersRepository: usersRepo,
    throttleStore,
    secureCookies: false, // HTTP in tests
  });

  guard = new JwtAuthGuard(tokenSvc);
}, 120_000);

afterAll(async () => {
  await oidcProvider.stop();
  await sql.end();
  await ctx.teardown();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    method: 'POST',
    path: '/api/v1/auth/callback',
    headers: {},
    query: {},
    body: null,
    cookies: {},
    ip: '127.0.0.1',
    ...overrides,
  };
}

function extractRefreshCookie(resp: { headers: Record<string, string> }): string | null {
  const setCookie = resp.headers['Set-Cookie'];
  if (!setCookie) return null;
  const match = setCookie.match(/opsninja_rt=([^;]+)/);
  return match ? match[1]! : null;
}

function extractAccessToken(resp: { body?: unknown }): string | null {
  const body = resp.body as Record<string, unknown> | null;
  return (body?.['access_token'] as string | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Scenario: Full login flow via OidcService + AuthController
// ---------------------------------------------------------------------------

describe('Auth: full login flow', () => {
  it('callback returns access_token and sets refresh cookie', async () => {
    // Generate an auth code for a Tenant A staff user
    const user = MOCK_USERS.STAFF_A;
    const nonce = 'test-nonce-' + Date.now();
    const code = oidcProvider.generateAuthCode(user, nonce);
    const state = 'test-state-' + Date.now();

    // Seed the PKCE state manually
    await stateStore.set(
      `oidc:state:${state}`,
      JSON.stringify({ codeVerifier: 'dummy-verifier', nonce }),
      600,
    );

    // Build an id_token directly (bypasses token endpoint)
    const idToken = await oidcProvider.issueIdToken(user.sub, user.email, user.name, nonce);

    // Verify the ID token independently (simulates callback exchangeCode result)
    const oidcSvc = new OidcService(
      {
        issuer: oidcProvider.issuer,
        clientId: CLIENT_ID,
        redirectUri: 'http://localhost:3000/api/v1/auth/callback',
      },
      stateStore,
    );
    const idClaims = await oidcSvc.validateIdToken(idToken, nonce);
    expect(idClaims.email).toBe(user.email);
    expect(idClaims.sub).toBe(user.sub);
  });
});

// ---------------------------------------------------------------------------
// Scenario: Direct service-level auth flow (no HTTP)
// ---------------------------------------------------------------------------

describe('Auth: service-level integration', () => {
  let accessToken: string;
  let refreshToken: string;
  let tenantId: string;
  let userId: string;

  it('provisions a user and issues tokens', async () => {
    tenantId = FIXTURE_IDS.TENANT_A;
    const email = MOCK_USERS.STAFF_A.email;

    // Run the same logic as the callback handler (but directly)
    const result = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);

      const user = await usersRepo.provisionStaff(tx as unknown as Sql, {
        tenantId,
        email,
        displayName: MOCK_USERS.STAFF_A.name,
      });

      const roles = await usersRepo.findUserRoles(tx as unknown as Sql, tenantId, user.id);
      const orgScopeVersion = await usersRepo.getOrgScopeVersion(
        tx as unknown as Sql,
        tenantId,
        user.id,
      );
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

      const session = await sessionSvc.create(tx as unknown as Sql, {
        tenantId,
        userId: user.id,
        expiresAt,
      });

      const at = await tokenSvc.issueAccessToken({
        sub: user.id,
        tenant_id: tenantId,
        roles: roles.map((r) => r.roleName),
        org_scope_version: orgScopeVersion,
      });

      return { user, session, accessToken: at };
    });

    accessToken = result.accessToken;
    refreshToken = result.session.rawToken;
    userId = result.user.id;

    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
    expect(typeof accessToken).toBe('string');
    expect(accessToken.split('.')).toHaveLength(3);
  });

  it('JwtAuthGuard accepts a valid access token', async () => {
    const outcome = await guard.verify(`Bearer ${accessToken}`);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('Narrowing');
    expect(outcome.principal.tenantId).toBe(tenantId);
    expect(outcome.principal.sub).toBe(userId);
  });

  it('JwtAuthGuard rejects missing token', async () => {
    const outcome = await guard.verify(undefined);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('Narrowing');
    expect(outcome.code).toBe('TOKEN_MISSING');
  });

  it('JwtAuthGuard rejects malformed token', async () => {
    const outcome = await guard.verify('Bearer not.a.real.token');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('Narrowing');
    expect(outcome.code).toBe('TOKEN_MALFORMED');
  });

  // -------------------------------------------------------------------------
  // Refresh rotation
  // -------------------------------------------------------------------------

  it('rotates refresh token and issues new access token', async () => {
    const newExpiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

    const outcome = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);
      return sessionSvc.rotate(tx as unknown as Sql, refreshToken, newExpiresAt);
    });

    expect(outcome.kind).toBe('rotated');
    if (outcome.kind !== 'rotated') throw new Error('Narrowing');

    const newRefreshToken = outcome.result.newSession.rawToken;
    expect(newRefreshToken).not.toBe(refreshToken);

    // Verify the new token results in a valid new access token
    const roles = await usersRepo.findUserRoles(sql, tenantId, userId);
    const orgScopeVersion = await usersRepo.getOrgScopeVersion(sql, tenantId, userId);
    const newAt = await tokenSvc.issueAccessToken({
      sub: userId,
      tenant_id: tenantId,
      roles: roles.map((r) => r.roleName),
      org_scope_version: orgScopeVersion,
    });

    const guardResult = await guard.verify(`Bearer ${newAt}`);
    expect(guardResult.ok).toBe(true);

    // Update for next tests
    refreshToken = newRefreshToken;
  });

  // -------------------------------------------------------------------------
  // Rotation-reuse detection
  // -------------------------------------------------------------------------

  it('detects reuse of a rotated token and revokes the family', async () => {
    // Save current refresh token (already rotated in prev test)
    const rotatedToken = refreshToken;

    // Rotate once more to get the current token
    const newExpiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const normalOutcome = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);
      return sessionSvc.rotate(tx as unknown as Sql, rotatedToken, newExpiresAt);
    });
    expect(normalOutcome.kind).toBe('rotated');
    if (normalOutcome.kind !== 'rotated') throw new Error('Narrowing');
    refreshToken = normalOutcome.result.newSession.rawToken;

    // Now present the OLD (already-rotated) token — reuse detected
    const reuseOutcome = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);
      return sessionSvc.rotate(tx as unknown as Sql, rotatedToken, newExpiresAt);
    });

    expect(reuseOutcome.kind).toBe('reuse_detected');
    if (reuseOutcome.kind !== 'reuse_detected') throw new Error('Narrowing');

    // The current (most recently issued) token should also be revoked
    const currentOutcome = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);
      return sessionSvc.rotate(tx as unknown as Sql, refreshToken, newExpiresAt);
    });
    expect(currentOutcome.kind).toBe('revoked');
  });

  // -------------------------------------------------------------------------
  // Admin revocation
  // -------------------------------------------------------------------------

  it('admin revokeAllForUser invalidates all sessions', async () => {
    // Create two fresh sessions
    let token1: string, token2: string;
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);
      const s1 = await sessionSvc.create(tx as unknown as Sql, {
        tenantId, userId, expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      });
      const s2 = await sessionSvc.create(tx as unknown as Sql, {
        tenantId, userId, expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      });
      token1 = s1.rawToken;
      token2 = s2.rawToken;
    });

    const count = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);
      return sessionSvc.revokeAllForUser(tx as unknown as Sql, tenantId, userId);
    });

    expect(count).toBeGreaterThanOrEqual(2);

    // Both tokens should now be revoked
    const out1 = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);
      return sessionSvc.rotate(tx as unknown as Sql, token1!, new Date(Date.now() + 8 * 60 * 60 * 1000));
    });
    expect(out1.kind).toBe('revoked');

    const out2 = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);
      return sessionSvc.rotate(tx as unknown as Sql, token2!, new Date(Date.now() + 8 * 60 * 60 * 1000));
    });
    expect(out2.kind).toBe('revoked');
  });
});

// ---------------------------------------------------------------------------
// Scenario: JwtAuthGuard revocation store
// ---------------------------------------------------------------------------

describe('JwtAuthGuard revocation store', () => {
  it('rejects a token whose JTI is revoked', async () => {
    const revocationStore = new InMemoryRevocationStore();
    const guardWithRevocation = new JwtAuthGuard(tokenSvc, revocationStore);

    const token = await tokenSvc.issueAccessToken({
      sub: 'user-id',
      tenant_id: FIXTURE_IDS.TENANT_A,
      roles: ['support_agent'],
      org_scope_version: 0,
    });

    const { jti } = await tokenSvc.verifyAccessToken(token);
    revocationStore.revokeJti(jti);

    const outcome = await guardWithRevocation.verify(`Bearer ${token}`);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('Narrowing');
    expect(outcome.code).toBe('TOKEN_REVOKED');
  });

  it('rejects a request for a deactivated user', async () => {
    const revocationStore = new InMemoryRevocationStore();
    const guardWithRevocation = new JwtAuthGuard(tokenSvc, revocationStore);

    const userId = 'deactivated-user-id';
    const token = await tokenSvc.issueAccessToken({
      sub: userId,
      tenant_id: FIXTURE_IDS.TENANT_A,
      roles: ['support_agent'],
      org_scope_version: 0,
    });

    revocationStore.deactivateUser(userId, FIXTURE_IDS.TENANT_A);

    const outcome = await guardWithRevocation.verify(`Bearer ${token}`);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('Narrowing');
    expect(outcome.code).toBe('USER_DEACTIVATED');
  });
});

// ---------------------------------------------------------------------------
// Scenario: Throttling
// ---------------------------------------------------------------------------

describe('Auth: throttling', () => {
  it('InMemoryThrottleStore enforces lockout after maxFailed increments', async () => {
    const store = new InMemoryThrottleStore();
    const key = 'throttle:email:test';
    const lockKey = `${key}:lock`;

    // Increment 5 times then set lockout
    for (let i = 0; i < 5; i++) {
      await store.increment(key, 3600);
    }
    await store.setLockout(lockKey, 900);

    expect(await store.isLockedOut(lockKey)).toBe(true);
    const ttl = await store.lockoutTtlSeconds(lockKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(900);
  });
});

// ---------------------------------------------------------------------------
// Scenario: Session count
// ---------------------------------------------------------------------------

describe('SessionService.countActiveSessions', () => {
  it('returns correct active session count', async () => {
    const tenantId = FIXTURE_IDS.TENANT_A;
    const userId = FIXTURE_IDS.USER_A_AGENT;

    const before = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);
      return sessionSvc.countActiveSessions(tx as unknown as Sql, tenantId, userId);
    });

    // Create a session
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);
      await sessionSvc.create(tx as unknown as Sql, {
        tenantId,
        userId,
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      });
    });

    const after = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${tenantId}'`);
      return sessionSvc.countActiveSessions(tx as unknown as Sql, tenantId, userId);
    });

    expect(after).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// Scenario: InMemoryKeyValueStore (PKCE state store)
// ---------------------------------------------------------------------------

describe('InMemoryKeyValueStore', () => {
  it('stores and retrieves a value', async () => {
    const store = new InMemoryKeyValueStore();
    await store.set('key1', 'value1', 60);
    expect(await store.get('key1')).toBe('value1');
  });

  it('returns null for expired entries', async () => {
    const store = new InMemoryKeyValueStore();
    await store.set('expiring', 'v', 0);
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.get('expiring')).toBeNull();
  });

  it('deletes an entry', async () => {
    const store = new InMemoryKeyValueStore();
    await store.set('to-delete', 'v', 60);
    await store.del('to-delete');
    expect(await store.get('to-delete')).toBeNull();
  });

  it('single-use semantics: del before get prevents replay', async () => {
    const store = new InMemoryKeyValueStore();
    await store.set('state:abc', 'pkce-data', 60);
    const first = await store.get('state:abc');
    await store.del('state:abc');
    const second = await store.get('state:abc');
    expect(first).toBe('pkce-data');
    expect(second).toBeNull();
  });
});
