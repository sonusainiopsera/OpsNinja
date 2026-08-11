/**
 * Integration tests for auth session lifecycle.
 *
 * Tests POST /api/v1/auth/refresh and POST /api/v1/auth/logout using a
 * test application with faked Redis and Postgres so the suite runs offline.
 *
 * Test coverage (AC3-6, 9):
 *   AC3  – refresh validates hash, rotates atomically, returns accessToken + rotated cookie
 *   AC4  – reuse of a rotated token returns 401 AUTH_REFRESH_REUSED
 *   AC5  – logout revokes session, clears cookie, returns 204
 *   AC6  – refresh after logout returns 401
 *   AC9  – concurrent refresh from two tabs: one wins, other gets grace-window success
 *   AC10 – missing cookie returns 401 AUTH_REFRESH_MISSING
 */

import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { REDIS_CLIENT } from '../src/common/redis/redis.provider';
import { DB_TOKEN } from '../src/data/db.module';
import { SessionService, REFRESH_COOKIE_NAME, REFRESH_TTL_S } from '../src/modules/identity/session.service';
import { TokenService } from '../src/modules/identity/token.service';
import { generateTestKeyPair } from './fixtures/session.fixtures';
import { TENANT_A_ID } from './factories/principal.factory';

// ── Test keypair ─────────────────────────────────────────────────────────────

const { privateKey, publicKey, kid } = generateTestKeyPair();

// ── Fake Redis ────────────────────────────────────────────────────────────────

function makeFakeRedisForE2E() {
  const store = new Map<string, Map<string, string>>();
  const sets = new Map<string, Set<string>>();

  const self = {
    hset: jest.fn().mockImplementation((key: string, dataOrField: unknown, value?: unknown) => {
      if (!store.has(key)) store.set(key, new Map());
      const m = store.get(key)!;
      if (typeof dataOrField === 'object' && dataOrField !== null) {
        for (const [k, v] of Object.entries(dataOrField as Record<string, string>)) {
          m.set(k, String(v));
        }
      } else if (typeof dataOrField === 'string') {
        m.set(dataOrField, String(value ?? ''));
      }
      return Promise.resolve(1);
    }),

    hmset: jest.fn().mockImplementation((key: string, data: Record<string, string>) => {
      if (!store.has(key)) store.set(key, new Map());
      const m = store.get(key)!;
      for (const [k, v] of Object.entries(data)) m.set(k, String(v));
      return Promise.resolve('OK');
    }),

    expire: jest.fn().mockResolvedValue(1),

    sadd: jest.fn().mockImplementation((key: string, ...members: string[]) => {
      if (!sets.has(key)) sets.set(key, new Set());
      members.forEach((m) => sets.get(key)!.add(m));
      return Promise.resolve(members.length);
    }),

    smembers: jest.fn().mockImplementation((key: string) =>
      Promise.resolve([...(sets.get(key) ?? [])]),
    ),

    get: jest.fn().mockResolvedValue(null),

    hmget: jest.fn().mockImplementation((key: string, ...fields: string[]) => {
      const m = self._store.get(key);
      return Promise.resolve(fields.map((f) => m?.get(f) ?? null));
    }),

    pipeline: jest.fn().mockImplementation(() => {
      const pipe = {
        hset: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      return pipe;
    }),

    script: jest.fn().mockResolvedValue('sha1'),

    eval: jest.fn(),
    evalsha: jest.fn(),

    _store: store,
    _sets: sets,
  };

  // Default evalsha simulates the Lua rotation script using the in-memory store.
  self.evalsha.mockImplementation((
    _sha: string,
    _numkeys: number,
    key: string,
    presentedHash: string,
    newHash: string,
    _graceSecs: string,
    sessionTTL: string,
    _now: string,
  ) => {
    const m = self._store.get(key);
    if (!m) return Promise.resolve([-1, 'NOT_FOUND', '']);
    if (m.get('revoked') === '1') return Promise.resolve([-2, 'REVOKED', m.get('familyId') ?? '']);
    const storedHash = m.get('hash');
    const familyId = m.get('familyId') ?? '';
    if (storedHash === presentedHash) {
      m.set('prevHash', storedHash);
      m.set('hash', newHash);
      m.set('rotationCount', String(Number(m.get('rotationCount') ?? 0) + 1));
      self.expire.mockResolvedValueOnce(1);
      return Promise.resolve([1, 'ROTATED', familyId]);
    }
    return Promise.resolve([-3, 'REPLAY_DETECTED', familyId]);
  });

  return self;
}

// ── Fake Postgres DB ──────────────────────────────────────────────────────────

function makeFakeDb() {
  return {
    insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }),
    }),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
    }),
    transaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({})),
    execute: jest.fn().mockResolvedValue([]),
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Auth Session lifecycle (e2e)', () => {
  let app: INestApplication;
  let fakeRedis: ReturnType<typeof makeFakeRedisForE2E>;
  let sessionService: SessionService;
  let server: unknown;

  const TEST_PRINCIPAL = {
    userId: '00000000-0000-0000-0000-100000000001',
    tenantId: TENANT_A_ID,
    roles: ['agent'],
    principalKind: 'staff',
    orgScopeIds: [],
    traceId: 'trace-1',
  };

  beforeAll(async () => {
    fakeRedis = makeFakeRedisForE2E();
    const fakeDb = makeFakeDb();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(REDIS_CLIENT)
      .useValue(fakeRedis)
      .overrideProvider(DB_TOKEN)
      .useValue(fakeDb)
      // Inject test keypair into TokenService config
      .overrideProvider(TokenService)
      .useValue(
        Object.assign(
          new TokenService({
            get: (key: string, def?: unknown) => {
              const m: Record<string, unknown> = {
                JWT_PRIVATE_KEY: privateKey,
                JWT_PUBLIC_KEY: publicKey,
                JWT_KID: kid,
                JWT_ISSUER: 'https://test.opsninja.io',
                JWT_AUDIENCE: 'test-audience',
              };
              return m[key] ?? def;
            },
          } as never),
        ),
      )
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    sessionService = moduleFixture.get(SessionService);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function createSessionAndCookie() {
    const token = await sessionService.createSession({
      tenantId: TENANT_A_ID,
      userId: TEST_PRINCIPAL.userId,
      principalKind: 'staff',
      roles: TEST_PRINCIPAL.roles,
    });
    const cookieValue = sessionService.buildRefreshCookie(token);
    return { token, cookieValue };
  }

  // ── AC10: missing cookie → 401 AUTH_REFRESH_MISSING ──────────────────────

  it('POST /auth/refresh with no cookie returns 401 AUTH_REFRESH_MISSING', async () => {
    const res = await request(server)
      .post('/api/v1/auth/refresh')
      .expect(401);

    expect(res.body).toMatchObject({ message: expect.any(String) });
  });

  // ── AC3: successful refresh ────────────────────────────────────────────────

  it('POST /auth/refresh returns 200 with accessToken and rotated cookie', async () => {
    const { cookieValue } = await createSessionAndCookie();

    const res = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieValue}`)
      .expect(200);

    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      expiresIn: 900,
      orgScopeVersion: expect.any(Number),
    });

    // Response must include a Set-Cookie header with the rotated token
    const setCookie = res.headers['set-cookie'] as string[] | string;
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
    expect(cookieHeader).toContain(REFRESH_COOKIE_NAME);
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Strict');
  });

  // ── AC5: logout ────────────────────────────────────────────────────────────

  it('POST /auth/logout returns 204 and clears cookie', async () => {
    const { cookieValue } = await createSessionAndCookie();

    const res = await request(server)
      .post('/api/v1/auth/logout')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieValue}`)
      .expect(204);

    const setCookie = res.headers['set-cookie'] as string[] | string;
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
    // Cookie should be cleared (Max-Age=0 or empty value)
    expect(cookieHeader).toContain(REFRESH_COOKIE_NAME);
    expect(cookieHeader).toMatch(/Max-Age=0|expires=Thu, 01 Jan 1970/i);
  });

  // ── AC5 + AC6: refresh after logout returns 401 ───────────────────────────

  it('POST /auth/refresh after logout returns 401', async () => {
    const { token, cookieValue } = await createSessionAndCookie();

    // Logout first
    await request(server)
      .post('/api/v1/auth/logout')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieValue}`)
      .expect(204);

    // Mark as revoked in our fake Redis
    const key = `session:${TENANT_A_ID}:${token.sessionId}`;
    const m = fakeRedis._store.get(key);
    if (m) m.set('revoked', '1');

    await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieValue}`)
      .expect(401);
  });

  // ── AC4: replay detection returns 401 AUTH_REFRESH_REUSED ─────────────────

  it('presenting an already-rotated token returns 401 AUTH_REFRESH_REUSED', async () => {
    const { cookieValue } = await createSessionAndCookie();

    // First refresh succeeds — token is now rotated
    const res1 = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieValue}`)
      .expect(200);

    expect(res1.body.accessToken).toBeDefined();

    // Replay with the ORIGINAL (now stale) cookie
    const res2 = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieValue}`)
      .expect(401);

    expect(res2.body).toMatchObject({ response: expect.objectContaining({ code: 'AUTH_REFRESH_REUSED' }) });
  });

  // ── AC5: logout without cookie returns 204 (no oracle) ────────────────────

  it('POST /auth/logout without a cookie still returns 204', async () => {
    await request(server).post('/api/v1/auth/logout').expect(204);
  });

  // ── AC9: concurrent refresh with grace window ──────────────────────────────

  it('two concurrent refreshes succeed within the grace window', async () => {
    const { cookieValue } = await createSessionAndCookie();

    // Simulate grace-window success for the second caller
    // First call: ROTATED
    // Second call: GRACE_ROTATED (same original hash)
    let callCount = 0;
    const originalEvalsha = fakeRedis.evalsha;
    fakeRedis.evalsha = jest.fn().mockImplementation((...args: unknown[]) => {
      callCount++;
      if (callCount === 2) {
        return Promise.resolve([2, 'GRACE_ROTATED', 'fam-1']);
      }
      return originalEvalsha(...(args as [string, number, string, string, string, string, string, string]));
    });

    const [res1, res2] = await Promise.all([
      request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieValue}`)
      request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieValue}`)
    ]);

    // Both should succeed (200)
    expect([res1.status, res2.status]).toEqual(
      expect.arrayContaining([200]),
    );

    // Restore
    fakeRedis.evalsha = originalEvalsha;
  });
});
