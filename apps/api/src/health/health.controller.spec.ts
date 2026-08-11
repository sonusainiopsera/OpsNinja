import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, HealthCheckError, TerminusModule } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PostgresHealthIndicator } from './indicators/postgres.health';
import { RedisHealthIndicator } from './indicators/redis.health';

// ─── Mock response helper ──────────────────────────────────────────────────────

function mockResponse() {
  const res: {
    statusCode: number;
    body: unknown;
    status: (code: number) => { json: (data: unknown) => void };
  } = {
    statusCode: 0,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return {
        json(data: unknown) {
          res.body = data;
        },
      };
    },
  };
  return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: HealthCheckService;

  const mockPostgresIndicator = {
    isHealthy: vi.fn(),
  };

  const mockRedisIndicator = {
    isHealthy: vi.fn(),
  };

  const mockConfigService = {
    get: vi.fn((key: string) => {
      if (key === 'BUILD_SHA') return 'test-sha-123';
      return 'test-value';
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        { provide: PostgresHealthIndicator, useValue: mockPostgresIndicator },
        { provide: RedisHealthIndicator, useValue: mockRedisIndicator },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get<HealthCheckService>(HealthCheckService);
  });

  describe('GET /healthz (liveness)', () => {
    it('returns status ok with version and uptime', () => {
      const result = controller.liveness();
      expect(result.status).toBe('ok');
      expect(result.version).toBe('test-sha-123');
      expect(typeof result.uptime_s).toBe('number');
      expect(result.uptime_s).toBeGreaterThanOrEqual(0);
    });

    it('does NOT call any dependency indicators', () => {
      controller.liveness();
      expect(mockPostgresIndicator.isHealthy).not.toHaveBeenCalled();
      expect(mockRedisIndicator.isHealthy).not.toHaveBeenCalled();
    });
  });

  describe('GET /readyz (readiness)', () => {
    it('returns 200 when all indicators pass', async () => {
      mockPostgresIndicator.isHealthy.mockResolvedValue({
        database: { status: 'up', latency_ms: 5 },
      });
      mockRedisIndicator.isHealthy.mockResolvedValue({
        redis: { status: 'up', latency_ms: 3 },
      });

      // We need to spy on health.check to control the Terminus result
      vi.spyOn(healthCheckService, 'check').mockResolvedValueOnce({
        status: 'ok',
        info: { database: { status: 'up' }, redis: { status: 'up' } },
        error: {},
        details: {
          database: { status: 'up', latency_ms: 5 },
          redis: { status: 'up', latency_ms: 3 },
        },
      });

      const res = mockResponse();
      await controller.readiness(res as never);

      expect(res.statusCode).toBe(200);
      const body = res.body as { status: string; dependencies: Record<string, unknown> };
      expect(body.status).toBe('ok');
      expect(body.dependencies['database']).toMatchObject({ ok: true });
      expect(body.dependencies['redis']).toMatchObject({ ok: true });
    });

    it('returns 503 when a dependency check throws HealthCheckError', async () => {
      // Terminus wraps indicator results in a HealthCheckResult: { status, info, error, details }
      vi.spyOn(healthCheckService, 'check').mockRejectedValueOnce(
        new HealthCheckError('Postgres is down', {
          status: 'error',
          info: {},
          error: { database: { status: 'down', latency_ms: 2001 } },
          details: {
            database: { status: 'down', latency_ms: 2001, error: 'connection refused' },
            redis: { status: 'up', latency_ms: 2 },
          },
        }),
      );

      const res = mockResponse();
      await controller.readiness(res as never);

      expect(res.statusCode).toBe(503);
      const body = res.body as { status: string; dependencies: Record<string, unknown> };
      expect(body.status).toBe('error');
      expect(body.dependencies).toHaveProperty('database');
    });

    it('returns 503 with an empty dependencies map on unexpected errors', async () => {
      vi.spyOn(healthCheckService, 'check').mockRejectedValueOnce(
        new HealthCheckError('Both down', { status: 'error', info: {}, error: {}, details: {} }),
      );

      const res = mockResponse();
      await controller.readiness(res as never);

      expect(res.statusCode).toBe(503);
      const body = res.body as { status: string };
      expect(body.status).toBe('error');
    });
  });
});
