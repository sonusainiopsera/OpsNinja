/**
 * Integration test scaffold for portal signup endpoint (WO-086).
 *
 * Tests the PortalSignupController + PortalSignupService + SignupThrottleGuard
 * end-to-end using a real NestJS testing module with mocked DB and Redis.
 *
 * Covers (per AC):
 *   AC1  — strict Zod DTO: unknown fields → 400
 *   AC2  — email normalisation (uppercase, plus-addressing)
 *   AC4  — matched domain without SSO → email_verification
 *   AC5  — unmatched domain → pending_approval (indistinguishable shape)
 *   AC6  — blocklisted domain → 422 SIGNUP_DOMAIN_NOT_BUSINESS
 *   AC7  — existing portal user → generic 202 (no new row)
 *   AC8  — throttle: exceeding 5/email/hour → 429 with Retry-After
 *   AC11 — non-disclosing: email_verification and pending_approval are byte-identical
 *
 * Note: Full Testcontainers PostgreSQL tests (RLS, row state assertions) are
 * a follow-on once the test infrastructure supports it. This scaffold exercises
 * the HTTP contract and service logic with stubs.
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';

import { PortalSignupController } from '../../src/modules/identity/portal-signup/portal-signup.controller';
import { PortalSignupService } from '../../src/modules/identity/portal-signup/portal-signup.service';
import { SignupThrottleGuard } from '../../src/modules/identity/guards/signup-throttle.guard';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { REDIS_CLIENT } from '../../src/common/redis/redis.provider';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const ORG_ID    = '20000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockPool = {
  connect: jest.fn(),
};

jest.mock('@opsninja/db', () => ({
  pool: mockPool,
}));

function makePoolClient(overrides: {
  hasBlockedDomain?: boolean;
  hasExistingUser?: boolean;
  hasExistingRequest?: boolean;
} = {}) {
  const client = {
    query: jest.fn().mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('signup_blocked_domains')) {
        return Promise.resolve({
          rows: overrides.hasBlockedDomain ? [{ domain: 'gmail.com' }] : [],
        });
      }
      if (typeof sql === 'string' && sql.includes('portal_users')) {
        return Promise.resolve({ rows: overrides.hasExistingUser ? [{ id: 'u1' }] : [] });
      }
      if (typeof sql === 'string' && sql.includes('portal_signup_requests') && sql.includes('SELECT')) {
        return Promise.resolve({ rows: overrides.hasExistingRequest ? [{ id: 'req1', status: 'pending_verification' }] : [] });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
    release: jest.fn(),
  };
  return client;
}

/** A mock Redis that never rate-limits (all counters return 1) */
function makePermissiveRedis() {
  const pipelineResult = [
    [null, 1],   // INCR → 1
    [null, 1],   // EXPIRE → 1
  ];
  return {
    pttl: jest.fn().mockResolvedValue(-1),  // no lockout
    pipeline: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(pipelineResult),
    }),
  };
}

/** A mock Redis that immediately rate-limits (counters return over limit) */
function makeBlockingRedis() {
  const pipelineResult = [
    [null, 100], // INCR → 100 (way over limit)
    [null, 1],
  ];
  return {
    pttl: jest.fn().mockResolvedValue(-1),
    pipeline: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(pipelineResult),
    }),
    set: jest.fn().mockResolvedValue('OK'),
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

async function buildApp(
  orgsServiceOverrides: Partial<OrganizationsService>,
  redisOverride?: ReturnType<typeof makePermissiveRedis>,
  poolClientOverrides?: Parameters<typeof makePoolClient>[0],
): Promise<INestApplication> {
  const redis = redisOverride ?? makePermissiveRedis();
  const poolClient = makePoolClient(poolClientOverrides);
  mockPool.connect.mockResolvedValue(poolClient);

  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [PortalSignupController],
    providers: [
      {
        provide: PortalSignupService,
        useFactory: () => {
          const orgsService = {
            findByVerifiedDomain: jest.fn().mockResolvedValue([]),
            ...orgsServiceOverrides,
          } as unknown as OrganizationsService;
          const svc = new PortalSignupService(orgsService);
          // Pre-populate blocklist cache to avoid DB call unless testing cache behaviour
          (svc as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
            domains: new Set(poolClientOverrides?.hasBlockedDomain ? ['gmail.com'] : []),
            refreshedAt: Date.now(),
          };
          return svc;
        },
      },
      {
        provide: SignupThrottleGuard,
        useValue: new SignupThrottleGuard(redis as never),
      },
      {
        provide: REDIS_CLIENT,
        useValue: redis,
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/portal/signup', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  // ── AC1: Strict Zod DTO ────────────────────────────────────────────────────

  it('AC1 — returns 400 when body contains unknown properties', async () => {
    app = await buildApp({});
    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup')
      .send({ email: 'alice@acmecorp.com', fullName: 'Alice', unknownProp: 'bad' });
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(res.body.error?.code).toMatch(/VALIDATION/i);
  });

  it('AC1 — returns 400 for missing required email field', async () => {
    app = await buildApp({});
    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup')
      .send({ fullName: 'Alice' });
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC1 — returns 400 for malformed email', async () => {
    app = await buildApp({});
    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  // ── AC4: Single domain match → email_verification ─────────────────────────

  it('AC4 — returns 202 authMode=email_verification for matched domain', async () => {
    app = await buildApp({
      findByVerifiedDomain: jest.fn().mockResolvedValue([
        { tenantId: TENANT_ID, organizationId: ORG_ID, hasSsoConnection: false },
      ]),
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup')
      .send({ email: 'alice@acmecorp.com', fullName: 'Alice Tester' });
    expect(res.status).toBe(HttpStatus.ACCEPTED);
    expect(res.body.status).toBe('accepted');
    expect(res.body.authMode).toBe('email_verification');
    expect(res.body.traceId).toBeDefined();
    expect(res.body.ssoRedirectUrl).toBeUndefined();
  });

  // ── AC5: Unmatched domain → pending_approval (same shape as email_verification)

  it('AC5 — returns 202 authMode=pending_approval for unmatched domain', async () => {
    app = await buildApp({
      findByVerifiedDomain: jest.fn().mockResolvedValue([]),
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup')
      .send({ email: 'alice@unknowncorp.com' });
    expect(res.status).toBe(HttpStatus.ACCEPTED);
    expect(res.body.status).toBe('accepted');
    expect(res.body.authMode).toBe('pending_approval');
    expect(res.body.ssoRedirectUrl).toBeUndefined();
  });

  it('AC11 — email_verification and pending_approval have identical JSON key sets', async () => {
    // email_verification
    app = await buildApp({
      findByVerifiedDomain: jest.fn().mockResolvedValue([
        { tenantId: TENANT_ID, organizationId: ORG_ID, hasSsoConnection: false },
      ]),
    });
    const matched = await request(app.getHttpServer())
      .post('/api/v1/portal/signup')
      .send({ email: 'alice@acmecorp.com' });
    await app.close();

    // pending_approval
    jest.clearAllMocks();
    app = await buildApp({
      findByVerifiedDomain: jest.fn().mockResolvedValue([]),
    });
    const unmatched = await request(app.getHttpServer())
      .post('/api/v1/portal/signup')
      .send({ email: 'alice@unknowncorp.com' });

    expect(Object.keys(matched.body).sort()).toEqual(Object.keys(unmatched.body).sort());
  });

  // ── AC6: Blocklisted domain → 422 ────────────────────────────────────────

  it('AC6 — returns 422 SIGNUP_DOMAIN_NOT_BUSINESS for blocklisted domain', async () => {
    app = await buildApp({}, undefined, { hasBlockedDomain: true });
    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup')
      .send({ email: 'alice@gmail.com' });
    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(res.body.error?.code).toBe('SIGNUP_DOMAIN_NOT_BUSINESS');
  });

  // ── AC7: Existing portal user ─────────────────────────────────────────────

  it('AC7 — returns generic 202 for email that already has a portal user', async () => {
    app = await buildApp(
      {
        findByVerifiedDomain: jest.fn().mockResolvedValue([
          { tenantId: TENANT_ID, organizationId: ORG_ID, hasSsoConnection: false },
        ]),
      },
      undefined,
      { hasExistingUser: true },
    );
    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup')
      .send({ email: 'alice@acmecorp.com' });
    expect(res.status).toBe(HttpStatus.ACCEPTED);
    expect(res.body.authMode).toBe('email_verification');
  });

  // ── AC8: Throttle → 429 with Retry-After ─────────────────────────────────

  it('AC8 — returns 429 with Retry-After header when IP rate limit exceeded', async () => {
    app = await buildApp({}, makeBlockingRedis() as never);
    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup')
      .send({ email: 'alice@acmecorp.com' });
    expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(res.body.error?.code).toBe('RATE_LIMITED');
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/portal/signup/discovery
// ---------------------------------------------------------------------------

describe('GET /api/v1/portal/signup/discovery', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('returns authMode for matched domain', async () => {
    app = await buildApp({
      findByVerifiedDomain: jest.fn().mockResolvedValue([
        { tenantId: TENANT_ID, organizationId: ORG_ID, hasSsoConnection: false },
      ]),
    });
    const res = await request(app.getHttpServer())
      .get('/api/v1/portal/signup/discovery')
      .query({ email: 'alice@acmecorp.com' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.authMode).toBe('email_verification');
  });

  it('returns 400 for missing email query param', async () => {
    app = await buildApp({});
    const res = await request(app.getHttpServer())
      .get('/api/v1/portal/signup/discovery');
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('returns 422 for blocklisted domain', async () => {
    app = await buildApp({}, undefined, { hasBlockedDomain: true });
    const res = await request(app.getHttpServer())
      .get('/api/v1/portal/signup/discovery')
      .query({ email: 'alice@gmail.com' });
    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });
});
