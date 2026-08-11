/**
 * RBAC integration tests.
 *
 * Bootstraps the full application with fake Redis and Postgres, then issues
 * real signed tokens for each of the six seeded roles and asserts allow/deny
 * outcomes against a representative endpoint matrix.
 *
 * All tokens are verified against the test keypair injected via TokenService override.
 * UnitOfWork is mocked so the TenantContextInterceptor does not require a real DB.
 */

import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Controller, Get } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { REDIS_CLIENT } from '../src/common/redis/redis.provider';
import { DB_TOKEN } from '../src/data/db.module';
import { TokenService } from '../src/modules/identity/token.service';
import { UnitOfWork } from '../src/data/unit-of-work';
import { RequestContextStore } from '../src/observability/request-context';
import { RequirePermission, Public } from '../src/common/auth/require-permission.decorator';
import { Permission } from '../src/common/auth/permissions';
import {
  ROLE_TOKENS,
  TEST_KEY_PAIR,
  TEST_ISSUER,
  STAFF_AUDIENCE,
  PORTAL_AUDIENCE,
  MACHINE_AUDIENCE,
  EXPIRED_TOKEN,
  INVALID_SIGNATURE_TOKEN,
} from './fixtures/rbac.fixtures';

// ── Test doubles ──────────────────────────────────────────────────────────────

function makeFakeRedis() {
  const store = new Map<string, string>();
  const counters = new Map<string, number>();
  return {
    get:  jest.fn().mockImplementation((key: string) => Promise.resolve(store.get(key) ?? null)),
    set:  jest.fn().mockImplementation((key: string, value: string) => { store.set(key, value); return Promise.resolve('OK'); }),
    incr: jest.fn().mockImplementation((key: string) => { const v = (counters.get(key) ?? 0) + 1; counters.set(key, v); return Promise.resolve(v); }),
    expire: jest.fn().mockResolvedValue(1),
    del:    jest.fn().mockResolvedValue(1),
    scan:   jest.fn().mockResolvedValue(['0', []]),
    hset:   jest.fn().mockResolvedValue(1),
    hmget:  jest.fn().mockResolvedValue([]),
    hgetall: jest.fn().mockResolvedValue(null),
    hmset:  jest.fn().mockResolvedValue('OK'),
    sadd:   jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    script: jest.fn().mockResolvedValue('sha'),
    eval:   jest.fn().mockResolvedValue([1, 'ROTATED', '']),
    evalsha: jest.fn().mockResolvedValue([1, 'ROTATED', '']),
    pipeline: jest.fn().mockReturnValue({ hset: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) }),
    _store: store,
    _counters: counters,
  };
}

function makeFakeDb() {
  return {
    insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
    update: jest.fn().mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }) }),
    select: jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }),
    transaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({})),
    execute: jest.fn().mockResolvedValue([]),
  };
}

// ── Test controllers ──────────────────────────────────────────────────────────

/** Routes used only in this test suite. NOT imported in AppModule. */
@Controller('_rbac')
class RbacTestController {
  @RequirePermission(Permission.TICKETS_READ)
  @Get('tickets-read')
  ticketsRead() { return { ok: true }; }

  @RequirePermission(Permission.ADMIN_WRITE)
  @Get('admin-write')
  adminWrite() { return { ok: true }; }

  @RequirePermission(Permission.PORTAL_TICKETS_READ)
  @Get('portal-read')
  portalRead() { return { ok: true }; }

  @RequirePermission(Permission.MACHINE_SYNC)
  @Get('machine-sync')
  machineSync() { return { ok: true }; }

  @Public()
  @Get('public')
  publicRoute() { return { public: true }; }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('RBAC (e2e)', () => {
  let app: INestApplication;
  let server: unknown;

  beforeAll(async () => {
    const fakeRedis = makeFakeRedis();
    const fakeDb = makeFakeDb();

    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [RbacTestController],
    })
      .overrideProvider(REDIS_CLIENT)
      .useValue(fakeRedis)
      .overrideProvider(DB_TOKEN)
      .useValue(fakeDb)
      .overrideProvider(TokenService)
      .useValue(
        new TokenService({
          get: (key: string, def?: unknown) => {
            const m: Record<string, unknown> = {
              JWT_PRIVATE_KEY:      TEST_KEY_PAIR.privateKey,
              JWT_PUBLIC_KEY:       TEST_KEY_PAIR.publicKey,
              JWT_KID:              TEST_KEY_PAIR.kid,
              JWT_ISSUER:           TEST_ISSUER,
              JWT_AUDIENCE:         STAFF_AUDIENCE,
              JWT_AUDIENCE_PORTAL:  PORTAL_AUDIENCE,
              JWT_AUDIENCE_MACHINE: MACHINE_AUDIENCE,
            };
            return m[key] ?? def;
          },
        } as never),
      )
      // Mock UnitOfWork so TenantContextInterceptor runs without a real DB connection
      .overrideProvider(UnitOfWork)
      .useValue({
        withTenantTransaction: jest.fn().mockImplementation(
          async (principal: unknown, fn: (tx: unknown) => Promise<unknown>) =>
            RequestContextStore.run({ principal: principal as never }, () => fn({})),
        ),
      })
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(() => app.close());

  // ── Public route ───────────────────────────────────────────────────────────

  it('public route accessible without token', async () => {
    await request(server).get('/api/v1/_rbac/public').expect(200);
  });

  // ── Missing token ──────────────────────────────────────────────────────────

  it('returns 401 AUTH_TOKEN_MISSING when no Bearer token', async () => {
    const res = await request(server).get('/api/v1/_rbac/tickets-read').expect(401);
    expect(res.body).toMatchObject({ response: expect.objectContaining({ code: 'AUTH_TOKEN_MISSING' }) });
  });

  // ── Expired token ──────────────────────────────────────────────────────────

  it('returns 401 AUTH_TOKEN_EXPIRED for expired token', async () => {
    const res = await request(server)
      .get('/api/v1/_rbac/tickets-read')
      .set('Authorization', `Bearer ${EXPIRED_TOKEN}`)
      .expect(401);
    expect(res.body).toMatchObject({ response: expect.objectContaining({ code: 'AUTH_TOKEN_EXPIRED' }) });
  });

  // ── Invalid signature ──────────────────────────────────────────────────────

  it('returns 401 AUTH_TOKEN_INVALID for token signed with unknown key', async () => {
    const res = await request(server)
      .get('/api/v1/_rbac/tickets-read')
      .set('Authorization', `Bearer ${INVALID_SIGNATURE_TOKEN}`)
      .expect(401);
    expect(res.body).toMatchObject({ response: expect.objectContaining({ code: 'AUTH_TOKEN_INVALID' }) });
  });

  // ── Role matrix: staff routes ──────────────────────────────────────────────

  it('admin can access tickets-read route', async () => {
    await request(server)
      .get('/api/v1/_rbac/tickets-read')
      .set('Authorization', `Bearer ${ROLE_TOKENS.admin}`)
      .expect(200);
  });

  it('agent can access tickets-read route', async () => {
    await request(server)
      .get('/api/v1/_rbac/tickets-read')
      .set('Authorization', `Bearer ${ROLE_TOKENS.agent}`)
      .expect(200);
  });

  it('readonly can access tickets-read route', async () => {
    await request(server)
      .get('/api/v1/_rbac/tickets-read')
      .set('Authorization', `Bearer ${ROLE_TOKENS.readonly}`)
      .expect(200);
  });

  it('agent cannot access admin-write route', async () => {
    const res = await request(server)
      .get('/api/v1/_rbac/admin-write')
      .set('Authorization', `Bearer ${ROLE_TOKENS.agent}`)
      .expect(403);
    expect(res.body).toMatchObject({ response: expect.objectContaining({ code: 'AUTHZ_PERMISSION_DENIED' }) });
  });

  it('admin can access admin-write route', async () => {
    await request(server)
      .get('/api/v1/_rbac/admin-write')
      .set('Authorization', `Bearer ${ROLE_TOKENS.admin}`)
      .expect(200);
  });

  // ── Audience enforcement ───────────────────────────────────────────────────

  it('portal token cannot access staff tickets-read route → 403 AUTHZ_AUDIENCE_MISMATCH', async () => {
    const res = await request(server)
      .get('/api/v1/_rbac/tickets-read')
      .set('Authorization', `Bearer ${ROLE_TOKENS.portal_user}`)
      .expect(403);
    expect(res.body).toMatchObject({ response: expect.objectContaining({ code: 'AUTHZ_AUDIENCE_MISMATCH' }) });
  });

  it('machine token cannot access staff tickets-read route → 403 AUTHZ_AUDIENCE_MISMATCH', async () => {
    const res = await request(server)
      .get('/api/v1/_rbac/tickets-read')
      .set('Authorization', `Bearer ${ROLE_TOKENS.worker}`)
      .expect(403);
    expect(res.body).toMatchObject({ response: expect.objectContaining({ code: 'AUTHZ_AUDIENCE_MISMATCH' }) });
  });

  it('portal user can access portal route', async () => {
    await request(server)
      .get('/api/v1/_rbac/portal-read')
      .set('Authorization', `Bearer ${ROLE_TOKENS.portal_user}`)
      .expect(200);
  });

  it('staff token cannot access portal route → 403 AUTHZ_AUDIENCE_MISMATCH', async () => {
    const res = await request(server)
      .get('/api/v1/_rbac/portal-read')
      .set('Authorization', `Bearer ${ROLE_TOKENS.agent}`)
      .expect(403);
    expect(res.body).toMatchObject({ response: expect.objectContaining({ code: 'AUTHZ_AUDIENCE_MISMATCH' }) });
  });

  it('machine worker can access machine-sync route', async () => {
    await request(server)
      .get('/api/v1/_rbac/machine-sync')
      .set('Authorization', `Bearer ${ROLE_TOKENS.worker}`)
      .expect(200);
  });

  it('staff token cannot access machine route → 403 AUTHZ_AUDIENCE_MISMATCH', async () => {
    const res = await request(server)
      .get('/api/v1/_rbac/machine-sync')
      .set('Authorization', `Bearer ${ROLE_TOKENS.agent}`)
      .expect(403);
    expect(res.body).toMatchObject({ response: expect.objectContaining({ code: 'AUTHZ_AUDIENCE_MISMATCH' }) });
  });

  // ── Audit record fields on denial ──────────────────────────────────────────

  it('403 response body contains traceId for correlation', async () => {
    const res = await request(server)
      .get('/api/v1/_rbac/admin-write')
      .set('Authorization', `Bearer ${ROLE_TOKENS.agent}`)
      .expect(403);

    expect(res.body).toMatchObject({
      response: expect.objectContaining({
        code: 'AUTHZ_PERMISSION_DENIED',
        traceId: expect.any(String),
      }),
    });
  });
});
