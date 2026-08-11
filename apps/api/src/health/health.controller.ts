import { Controller, Get, Res } from '@nestjs/common';
import { HealthCheckService, HealthCheckError } from '@nestjs/terminus';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@opsninja/shared';
import { PostgresHealthIndicator } from './indicators/postgres.health';
import { RedisHealthIndicator } from './indicators/redis.health';

/** Response shape for GET /healthz */
interface LivenessResponse {
  status: 'ok';
  version: string;
  uptime_s: number;
}

/** Per-dependency status in the readiness response. */
interface DependencyStatus {
  ok: boolean;
  latency_ms?: number;
}

/** Response shape for GET /readyz (success) */
interface ReadinessOkResponse {
  status: 'ok';
  dependencies: Record<string, DependencyStatus>;
}

/** Response shape for GET /readyz (failure) */
interface ReadinessErrorResponse {
  status: 'error';
  dependencies: Record<string, DependencyStatus>;
}

@ApiTags('observability')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly postgresIndicator: PostgresHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  /**
   * Liveness probe — always returns 200 without touching external dependencies.
   * Use this endpoint for Kubernetes `livenessProbe`.
   */
  @Get('healthz')
  @ApiOperation({ summary: 'Liveness probe', description: 'Always 200; no dependency checks.' })
  @ApiResponse({ status: 200 })
  liveness(): LivenessResponse {
    return {
      status: 'ok',
      version: this.configService.get('BUILD_SHA', { infer: true }),
      uptime_s: Math.floor(process.uptime()),
    };
  }

  /**
   * Readiness probe — returns 200 only when all dependencies are healthy.
   * Use this endpoint for Kubernetes `readinessProbe`.
   * Returns 503 with a per-dependency status map during graceful shutdown
   * or when any dependency is unavailable.
   */
  @Get('readyz')
  @ApiOperation({
    summary: 'Readiness probe',
    description: '200 when dependencies are healthy; 503 with dependency map otherwise.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 503 })
  async readiness(
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    try {
      const result = await this.health.check([
        async () => this.postgresIndicator.isHealthy('database'),
        async () => this.redisIndicator.isHealthy('redis'),
      ]);

      // Parse Terminus details into the API contract shape
      const dependencies: Record<string, DependencyStatus> = {};
      for (const [key, value] of Object.entries(result.details)) {
        const detail = value as { status: string; latency_ms?: number };
        dependencies[key] = {
          ok: detail.status === 'up',
          latency_ms: detail.latency_ms,
        };
      }

      const response: ReadinessOkResponse = { status: 'ok', dependencies };
      res.status(200).json(response);
    } catch (err) {
      // HealthCheckError carries the per-indicator results in `causes`
      const dependencies: Record<string, DependencyStatus> = {};

      if (err instanceof HealthCheckError) {
        // Terminus HealthCheckError.causes is a HealthCheckResult:
        // { status, info, error, details: { [indicatorKey]: { status, ... } } }
        // We need the `details` map which has all indicator results.
        const causes = err.causes as Record<string, unknown>;
        const indicatorMap = (
          typeof causes['details'] === 'object' && causes['details'] !== null
        )
          ? (causes['details'] as Record<string, Record<string, unknown>>)
          : (causes as Record<string, Record<string, unknown>>);

        for (const [key, value] of Object.entries(indicatorMap)) {
          // Skip HealthCheckResult meta-fields
          if (key === 'status' || key === 'info' || key === 'error') continue;
          if (typeof value !== 'object' || value === null) continue;
          const detail = value as { status?: string; latency_ms?: number };
          dependencies[key] = {
            ok: detail.status === 'up',
            latency_ms: detail.latency_ms,
          };
        }
      }

      const response: ReadinessErrorResponse = { status: 'error', dependencies };
      res.status(503).json(response);
    }
import { Controller, Get } from '@nestjs/common';
import { NoTenantContext } from '../common/tenant';

@NoTenantContext()
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  ready(): { status: string } {
    return { status: 'ready' };
  }
}
