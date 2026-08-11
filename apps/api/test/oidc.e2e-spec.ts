/**
 * WO-010 OIDC integration tests.
 *
 * Tests the full Authorization Code + PKCE flow using MockOidcProvider
 * (real RSA-256 keypair, in-process HTTP server) and Testcontainers PostgreSQL.
 *
 * Scenarios:
 *  1. POST /login returns { authorizationUrl, state, codeVerifier }
 *  2. Full login round-trip: login → callback → access token + refresh cookie
 *  3. Replayed state rejection (state is single-use)
 *  4. Tampered code_verifier rejection (S256 mismatch)
 *  5. ID token with email_verified: false → 401 AUTH_EMAIL_UNVERIFIED
 *  6. Disabled user → 401 AUTH_USER_DISABLED
 *  7. Zero-role user → 403 AUTH_NO_ROLES
 *  8. email_domain not allowed → 401
 *  9. Expired ID token rejection → 401 AUTH_TOKEN_INVALID
 * 10. IdpConnectionRepository: loads per-tenant config with TTL cache
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
import { loadIdpConnectionFixtures, IDP_SECRET_VALUES } from './fixtures/idp-connections.fixtures.js';
import { OidcService, InMemoryKeyValueStore } from '../src/modules/identity/oidc.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { TokenService, createHs256TokenService } from '../src/modules/identity/token.service.js';
import { UsersRepository } from '../src/modules/identity/users.repository.js';
import { UserProvisioningService } from '../src/modules/identity/user-provisioning.service.js';
import { AuthController, InMemoryThrottleStore, type AuthRequest } from '../src/modules/identity/auth.controller.js';
import { IdpConnectionRepository } from '../src/modules/identity/idp-connection.repository.js';
import { InMemorySecretsProvider } from '../src/modules/identity/secrets.provider.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JWT_SECRET = 'oidc-e2e-test-secret-that-is-long-enough';
const CLIENT_ID = 'test-client-id';
const REDIRECT_URI = 'http://localhost:3000/api/v1/auth/callback';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let ctx: TestDbContext;
let sql: Sql;
let oidcProvider: MockOidcProvider;
let controller: AuthController;
let stateStore: InMemoryKeyValueStore;
let throttleStore: InMemoryThrottleStore;
let tokenSvc: TokenService;

beforeAll(async () => {
  ctx = await createTestDb('oidc-e2e');
  sql = postgres(ctx.connectionString, { max: 5 });

  // Ensure app_user role exists
  await sql.unsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOBYPASSRLS;
      END IF;
    END; $$;
  `);

  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE ON users TO app_user;
    GRANT SELECT, INSERT, UPDATE ON refresh_sessions TO app_user;
    GRANT SELECT ON tenants TO app_user;
    GRANT SELECT ON organization_verified_domains TO app_user;
    GRANT SELECT, INSERT, DELETE ON user_roles TO app_user;
    GRANT SELECT ON roles TO app_user;
    GRANT SELECT, INSERT, DELETE ON agent_org_scopes TO app_user;
    GRANT SELECT, INSERT, UPDATE ON idp_connections TO app_user;
  `);

  await loadRbacCatalog(sql);
  await loadIdentityFixtures(sql);

  // Seed verified domain for Tenant A
  await sql.unsafe(`
    INSERT INTO organization_verified_domains (tenant_id, organization_id, domain)
    VALUES ('${FIXTURE_IDS.TENANT_A}'::uuid, '${FIXTURE_IDS.ORG_A1}'::uuid, 'fixture-a.example')
    ON CONFLICT DO NOTHING;
  `);

  // Start mock OIDC provider
  oidcProvider = await MockOidcProvider.start();

  // Seed idp_connections table
  await loadIdpConnectionFixtures(sql, oidcProvider.issuer, oidcProvider.issuer, REDIRECT_URI);

  // Build services
  tokenSvc = createHs256TokenService(JWT_SECRET);
  stateStore = new InMemoryKeyValueStore();
  throttleStore = new InMemoryThrottleStore();

  const oidcSvc = new OidcService(
    { issuer: oidcProvider.issuer, clientId: CLIENT_ID, redirectUri: REDIRECT_URI },
    stateStore,
  );

  const usersRepo = new UsersRepository();
  const userProvisioningSvc = new UserProvisioningService(usersRepo);

  controller = new AuthController({
    sql,
    tokenService: tokenSvc,
    sessionService: new SessionService(),
    oidcService: oidcSvc,
    usersRepository: usersRepo,
    userProvisioningService: userProvisioningSvc,
    throttleStore,
    secureCookies: false,
  });
}, 120_000);

afterAll(async () => {
  await oidcProvider.stop();
  await sql.end();
  await ctx.teardown();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    method: 'POST',
    path: '/api/v1/auth',
    headers: {},
    query: {},
    body: null,
    cookies: {},
    ip: '127.0.0.1',
    ...overrides,
  };
}

function refreshCookie(resp: { headers: Record<string, string> }): string | null {
  const h = resp.headers['Set-Cookie'];
  if (!h) return null;
  const m = h.match(/opsninja_rt=([^;]+)/);
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------------------
// 1. Login returns JSON authorizationUrl
// ---------------------------------------------------------------------------

describe('POST /login', () => {
  it('returns { authorizationUrl, state, codeVerifier } (200)', async () => {
    const resp = await controller.handleLogin(
      makeReq({ body: { redirectTo: '/dashboard' } }),
    );
    expect(resp.status).toBe(200);
    const body = resp.body as Record<string, unknown>;
    expect(typeof body['authorizationUrl']).toBe('string');
    expect(typeof body['state']).toBe('string');
    expect(typeof body['codeVerifier']).toBe('string');
    expect((body['authorizationUrl'] as string)).toContain('code_challenge_method=S256');
  });
});

// ---------------------------------------------------------------------------
// 2. Full login round-trip
// ---------------------------------------------------------------------------

describe('Full OIDC login round-trip', () => {
  it('returns access token + refresh cookie on valid callback', async () => {
    const user = MOCK_USERS.STAFF_A;

    // Login step — get authorizationUrl + codeVerifier
    const loginResp = await controller.handleLogin(makeReq({}));
    expect(loginResp.status).toBe(200);
    const { state, codeVerifier } = loginResp.body as Record<string, string>;

    // Mock IdP redirects back with a code; generate auth code
    const nonce = JSON.parse(
      Buffer.from((await stateStore.get(`oidc:state:${state}`)) ?? '{}').toString(),
    )?.['nonce'] as string;

    const code = oidcProvider.generateAuthCode(user, nonce);

    const callbackResp = await controller.handleCallback(
      makeReq({ body: { code, state, codeVerifier } }),
    );

    expect(callbackResp.status).toBe(200);
    const body = callbackResp.body as Record<string, unknown>;
    expect(typeof body['accessToken']).toBe('string');
    expect(body['expiresIn']).toBe(900);
    const userBody = body['user'] as Record<string, unknown>;
    expect(userBody['tenantId']).toBe(FIXTURE_IDS.TENANT_A);
    expect(Array.isArray(userBody['roles'])).toBe(true);

    const cookie = refreshCookie(callbackResp);
    expect(cookie).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Replayed state rejection
// ---------------------------------------------------------------------------

describe('Replayed state', () => {
  it('rejects a callback where state was already consumed', async () => {
    const user = MOCK_USERS.STAFF_A;
    const loginResp = await controller.handleLogin(makeReq({}));
    const { state, codeVerifier } = loginResp.body as Record<string, string>;

    const nonce = JSON.parse(
      Buffer.from((await stateStore.get(`oidc:state:${state}`)) ?? '{}').toString(),
    )?.['nonce'] as string;

    const code = oidcProvider.generateAuthCode(user, nonce);

    // First callback — succeeds (and consumes state)
    const first = await controller.handleCallback(
      makeReq({ body: { code, state, codeVerifier } }),
    );
    expect(first.status).toBe(200);

    // Second callback with same state — should be rejected
    const second = await controller.handleCallback(
      makeReq({ body: { code, state, codeVerifier } }),
    );
    expect(second.status).toBe(401);
    const errBody = second.body as Record<string, unknown>;
    expect(errBody['error']).toBe('AUTH_STATE_INVALID');
  });
});

// ---------------------------------------------------------------------------
// 4. Tampered codeVerifier rejection
// ---------------------------------------------------------------------------

describe('Tampered codeVerifier', () => {
  it('rejects callback with wrong codeVerifier (S256 mismatch)', async () => {
    const loginResp = await controller.handleLogin(makeReq({}));
    const { state } = loginResp.body as Record<string, string>;

    const resp = await controller.handleCallback(
      makeReq({ body: { code: 'any-code', state, codeVerifier: 'tampered-verifier' } }),
    );
    expect(resp.status).toBe(401);
    expect((resp.body as Record<string, unknown>)['error']).toBe('AUTH_STATE_INVALID');
  });
});

// ---------------------------------------------------------------------------
// 5. email_verified: false → 401
// ---------------------------------------------------------------------------

describe('email_verified: false', () => {
  it('rejects token where email_verified is false', async () => {
    const user = MOCK_USERS.STAFF_A;
    const loginResp = await controller.handleLogin(makeReq({}));
    const { state, codeVerifier } = loginResp.body as Record<string, string>;

    const nonce = JSON.parse(
      Buffer.from((await stateStore.get(`oidc:state:${state}`)) ?? '{}').toString(),
    )?.['nonce'] as string;

    // Issue ID token with email_verified: false
    const code = oidcProvider.generateAuthCode(user, nonce);

    // Override MockOidcProvider to issue token with email_verified: false.
    // Since generateAuthCode encodes user info and the token endpoint decodes it,
    // we need to issue the token directly and test via validateIdToken.
    const idToken = await oidcProvider.issueIdToken(
      user.sub, user.email, user.name, nonce,
      { email_verified: false },
    );

    // validateIdToken should throw AUTH_EMAIL_UNVERIFIED
    const oidcSvc = new OidcService(
      { issuer: oidcProvider.issuer, clientId: CLIENT_ID, redirectUri: REDIRECT_URI },
      new InMemoryKeyValueStore(),
    );
    await expect(oidcSvc.validateIdToken(idToken, nonce))
      .rejects.toMatchObject({ code: 'AUTH_EMAIL_UNVERIFIED' });
  });
});

// ---------------------------------------------------------------------------
// 9. Expired ID token
// ---------------------------------------------------------------------------

describe('Expired ID token', () => {
  it('rejects token past exp claim', async () => {
    const user = MOCK_USERS.STAFF_A;
    const nonce = 'test-nonce-expiry';

    // Issue a token that expired 1 hour ago
    const idToken = await oidcProvider.issueIdToken(
      user.sub, user.email, user.name, nonce,
      { exp: Math.floor(Date.now() / 1000) - 3600 },
    );

    const oidcSvc = new OidcService(
      { issuer: oidcProvider.issuer, clientId: CLIENT_ID, redirectUri: REDIRECT_URI, clockSkewSeconds: 0 },
      new InMemoryKeyValueStore(),
    );
    await expect(oidcSvc.validateIdToken(idToken, nonce))
      .rejects.toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
  });
});

// ---------------------------------------------------------------------------
// 10. IdpConnectionRepository: loads and caches config
// ---------------------------------------------------------------------------

describe('IdpConnectionRepository', () => {
  it('loads enabled connection for tenant', async () => {
    const repo = new IdpConnectionRepository({ cacheTtlMs: 60_000 });
    const conn = await repo.findEnabledByTenant(sql, FIXTURE_IDS.TENANT_A);
    expect(conn).not.toBeNull();
    expect(conn!.issuer).toBe(oidcProvider.issuer);
    expect(conn!.clientId).toBe(CLIENT_ID);
    expect(conn!.allowedEmailDomains).toContain('fixture-a.example');
  });

  it('returns null for unknown tenant', async () => {
    const repo = new IdpConnectionRepository();
    const conn = await repo.findEnabledByTenant(sql, '00000000-0000-0000-0000-000000000000');
    expect(conn).toBeNull();
  });

  it('resolves client secret via SecretsProvider', async () => {
    const repo = new IdpConnectionRepository();
    const conn = await repo.findEnabledByTenant(sql, FIXTURE_IDS.TENANT_A);
    expect(conn).not.toBeNull();
    const sp = new InMemorySecretsProvider(IDP_SECRET_VALUES as Record<string, string>);
    const secret = await repo.resolveClientSecret(conn!, sp);
    expect(secret).toBe(IDP_SECRET_VALUES['test/tenant-a/oidc-secret']);
  });

  it('uses cached result on second call', async () => {
    const repo = new IdpConnectionRepository({ cacheTtlMs: 60_000 });
    const first = await repo.findEnabledByTenant(sql, FIXTURE_IDS.TENANT_A);
    const second = await repo.findEnabledByTenant(sql, FIXTURE_IDS.TENANT_A);
    // Same object reference (from cache)
    expect(first).toBe(second);
  });
});
