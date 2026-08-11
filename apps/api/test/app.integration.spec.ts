import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthCheckError } from '@nestjs/terminus';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PostgresHealthIndicator } from '../src/health/indicators/postgres.health';
import { RedisHealthIndicator } from '../src/health/indicators/redis.health';
import { StubModule } from './stub/stub.module';

/**
 * Integration test suite — boots the full NestJS application with:
 * - In-memory config (via test/setup.ts which seeds process.env)
 * - Stubbed health indicators so no real DB/Redis is required
 * - StubModule providing test endpoints that exercise all error paths
 */
describe('App Integration', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    // Mock pg and ioredis to prevent actual connection attempts during module init
    vi.mock('pg', () => ({ Client: vi.fn() }));
    vi.mock('ioredis', () => ({ default: vi.fn() }));

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule, StubModule],
    })
      // Override health indicators so the test doesn't need a real database.
      // When an indicator throws HealthCheckError, Terminus wraps it into
      // a full HealthCheckResult (status, info, error, details) before
      // re-throwing from HealthCheckService.check().
      // We throw HealthCheckError with the indicator-result format;
      // Terminus processes it into the full format the controller reads.
      .overrideProvider(PostgresHealthIndicator)
      .useValue({
        isHealthy: vi.fn().mockRejectedValue(
          new HealthCheckError('Postgres down', {
            database: { status: 'down', latency_ms: 2001, error: 'connection refused' },
          }),
        ),
      })
      .overrideProvider(RedisHealthIndicator)
      .useValue({
        isHealthy: vi.fn().mockRejectedValue(
          new HealthCheckError('Redis down', {
            redis: { status: 'down', latency_ms: 2001, error: 'connection refused' },
          }),
        ),
      })
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  // ── /healthz ────────────────────────────────────────────────────────────────

  describe('GET /api/v1/healthz', () => {
    it('returns 200 with status, version, and uptime', async () => {
      const res = await request(httpServer).get('/api/v1/healthz');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        version: expect.any(String),
        uptime_s: expect.any(Number),
      });
    });

    it('responds without checking dependencies', async () => {
      // Make multiple concurrent requests — all must succeed
      const results = await Promise.all(
        Array.from({ length: 5 }, () => request(httpServer).get('/api/v1/healthz')),
      );
      results.forEach((res) => expect(res.status).toBe(200));
    });
  });

  // ── /readyz ─────────────────────────────────────────────────────────────────

  describe('GET /api/v1/readyz', () => {
    it('returns 503 when health indicators fail', async () => {
      const res = await request(httpServer).get('/api/v1/readyz');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        status: 'error',
        dependencies: expect.any(Object),
      });
    });

    it('includes dependency names in the response', async () => {
      const res = await request(httpServer).get('/api/v1/readyz');
      expect(res.body.dependencies).toHaveProperty('database');
      expect(res.body.dependencies).toHaveProperty('redis');
    });

    it('marks failing dependencies as ok: false', async () => {
      const res = await request(httpServer).get('/api/v1/readyz');
      const deps = res.body.dependencies as Record<string, { ok: boolean }>;
      expect(deps['database']?.ok).toBe(false);
      expect(deps['redis']?.ok).toBe(false);
    });
  });

  // ── 404 envelope ─────────────────────────────────────────────────────────────

  describe('Unknown routes', () => {
    it('returns a 404 error envelope for an unknown route', async () => {
      const res = await request(httpServer).get('/api/v1/this-route-does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        error: {
          code: 'NOT_FOUND',
          message: expect.any(String),
          details: expect.any(Array),
          traceId: expect.any(String),
        },
      });
    });

    it('does not expose stack traces in 404 responses', async () => {
      const res = await request(httpServer).get('/api/v1/unknown');
      expect(JSON.stringify(res.body)).not.toContain('stack');
      expect(JSON.stringify(res.body)).not.toContain('at ');
    });
  });

  // ── X-Trace-ID header ─────────────────────────────────────────────────────────

  describe('Trace ID propagation', () => {
    it('reflects the X-Trace-ID header in the response', async () => {
      const traceId = 'my-custom-trace-12345';
      const res = await request(httpServer)
        .get('/api/v1/healthz')
        .set('X-Trace-ID', traceId);
      expect(res.headers['x-trace-id']).toBe(traceId);
    });

    it('generates a traceId when X-Trace-ID is not provided', async () => {
      const res = await request(httpServer).get('/api/v1/healthz');
      expect(res.headers['x-trace-id']).toBeTruthy();
    });

    it('assigns distinct traceIds to concurrent requests', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => request(httpServer).get('/api/v1/healthz')),
      );
      const traceIds = results.map((r) => r.headers['x-trace-id'] as string);
      const unique = new Set(traceIds);
      expect(unique.size).toBe(10);
    });
  });

  // ── Stub controller endpoints ─────────────────────────────────────────────────

  describe('Stub endpoints — error envelope verification', () => {
    it('GET /stub/not-found → 404 NOT_FOUND envelope', async () => {
      const res = await request(httpServer).get('/api/v1/stub/not-found');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.traceId).toBeTruthy();
    });

    it('GET /stub/unauthorized → 401 UNAUTHORIZED envelope', async () => {
      const res = await request(httpServer).get('/api/v1/stub/unauthorized');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /stub/forbidden → 403 FORBIDDEN envelope', async () => {
      const res = await request(httpServer).get('/api/v1/stub/forbidden');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('GET /stub/conflict → 409 CONFLICT envelope', async () => {
      const res = await request(httpServer).get('/api/v1/stub/conflict');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('GET /stub/unprocessable → 422 UNPROCESSABLE_ENTITY envelope', async () => {
      const res = await request(httpServer).get('/api/v1/stub/unprocessable');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
    });

    it('GET /stub/rate-limited → 429 with Retry-After header', async () => {
      const res = await request(httpServer).get('/api/v1/stub/rate-limited');
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(res.headers['retry-after']).toBe('60');
    });

    it('GET /stub/validate with missing required fields → 400 VALIDATION_ERROR', async () => {
      const res = await request(httpServer).get('/api/v1/stub/validate');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toBeInstanceOf(Array);
      expect(res.body.error.details.length).toBeGreaterThan(0);
      // Each detail should have field and issue
      const detail = res.body.error.details[0] as { field: string; issue: string };
      expect(detail).toHaveProperty('field');
      expect(detail).toHaveProperty('issue');
    });
  });

  // ── Pagination ─────────────────────────────────────────────────────────────────

  describe('Cursor pagination — stub list endpoint', () => {
    it('returns items and a next_cursor for the first page', async () => {
      const res = await request(httpServer).get('/api/v1/stub/list?limit=2');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        items: expect.any(Array),
        next_cursor: expect.any(String),
      });
      expect(res.body.items.length).toBe(2);
    });

    it('traverses to the second page using the cursor', async () => {
      // Page 1
      const page1 = await request(httpServer).get('/api/v1/stub/list?limit=2');
      expect(page1.status).toBe(200);
      const cursor = page1.body.next_cursor as string;
      expect(cursor).toBeTruthy();

      // Page 2
      const page2 = await request(httpServer).get(
        `/api/v1/stub/list?limit=2&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(page2.status).toBe(200);
      expect(page2.body.items.length).toBeGreaterThan(0);

      // Pages must be disjoint
      const ids1 = (page1.body.items as Array<{ id: string }>).map((i) => i.id);
      const ids2 = (page2.body.items as Array<{ id: string }>).map((i) => i.id);
      const overlap = ids1.filter((id) => ids2.includes(id));
      expect(overlap).toHaveLength(0);
    });

    it('returns null next_cursor on the last page', async () => {
      // Request all 5 fixture items in one page
      const res = await request(httpServer).get('/api/v1/stub/list?limit=100');
      expect(res.status).toBe(200);
      expect(res.body.next_cursor).toBeNull();
    });

    it('rejects a tampered cursor with 400 INVALID_CURSOR', async () => {
      const res = await request(httpServer).get(
        '/api/v1/stub/list?cursor=tampered.AAAAAAAAAAAAAAAAAAAAAA',
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CURSOR');
    });
  });

  // ── Error envelope structure invariants ──────────────────────────────────────

  describe('Error envelope invariants', () => {
    it('every error response has the frozen envelope shape', async () => {
      const errorRoutes = [
        '/api/v1/stub/not-found',
        '/api/v1/stub/unauthorized',
        '/api/v1/stub/forbidden',
        '/api/v1/stub/conflict',
        '/api/v1/stub/unprocessable',
        '/api/v1/unknown-route',
      ];

      const responses = await Promise.all(
        errorRoutes.map((route) => request(httpServer).get(route)),
      );

      responses.forEach((res) => {
        expect(res.body).toHaveProperty('error');
        expect(res.body.error).toHaveProperty('code');
        expect(res.body.error).toHaveProperty('message');
        expect(res.body.error).toHaveProperty('details');
        expect(res.body.error).toHaveProperty('traceId');
        expect(res.body.error.code).toMatch(/^[A-Z_]+$/); // UPPER_SNAKE
        expect(typeof res.body.error.message).toBe('string');
        expect(Array.isArray(res.body.error.details)).toBe(true);
      });
    });
  });

  // ── OpenAPI document ──────────────────────────────────────────────────────────

  describe('OpenAPI document', () => {
    it('serves the OpenAPI JSON at /api/v1/openapi.json', async () => {
      const res = await request(httpServer).get('/api/v1/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('openapi');
      expect(res.body).toHaveProperty('info');
      expect(res.body).toHaveProperty('paths');
    });
  });
});
