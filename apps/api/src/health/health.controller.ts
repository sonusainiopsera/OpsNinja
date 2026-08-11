import { Controller, Get, HttpCode, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NoTenantContext } from '../common/tenant';
import { ReplicaLagProbe } from '../modules/reporting/infrastructure/replica-lag.probe';

@NoTenantContext()
@Controller('health')
export class HealthController {
  constructor(
    @Optional() private readonly lagProbe: ReplicaLagProbe | null,
    @Optional() private readonly config: ConfigService | null,
  ) {}

  @Get()
  check(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  ready(): { status: string } {
    return { status: 'ready' };
  }

  /**
   * Returns 200 when the replica is reachable and lag is below the configurable
   * threshold (default 120 s).  Returns 503 otherwise.
   *
   * Response body never contains connection strings or stack traces.
   */
  @Get('reporting-replica')
  @HttpCode(200)
  reportingReplica(): { status: string; lagSeconds: number; standalone: boolean } {
    if (!this.lagProbe) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        reason: 'reporting_replica_not_configured',
      });
    }

    const freshness = this.lagProbe.getReplicaFreshness();
    const maxLagSeconds =
      this.config?.get<number>('REPORTING_REPLICA_LAG_THRESHOLD_SECONDS', 120) ?? 120;

    if (freshness.sampledAt === 0) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        reason: 'probe_not_yet_sampled',
      });
    }

    if (!freshness.isStandalone && freshness.lagSeconds > maxLagSeconds) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        reason: 'replica_lag_exceeded',
        lagSeconds: freshness.lagSeconds,
        thresholdSeconds: maxLagSeconds,
      });
    }

    return {
      status: 'ok',
      lagSeconds: freshness.lagSeconds,
      standalone: freshness.isStandalone,
    };
  }
}
