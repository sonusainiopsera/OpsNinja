/**
 * Health-check controller — exempt from tenant context.
 *
 * Load balancers and uptime monitors call GET /health repeatedly.
 * This endpoint must not open a database transaction on every probe.
 */

import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { NoTenantContext } from '../common/tenant/no-tenant-context.decorator';
import { Public } from '../common/auth/public.decorator';
import { ReplicaLagProbe } from '../modules/reporting/infrastructure/replica-lag.probe';

@Public()
@NoTenantContext()
@Controller('health')
export class HealthController {
  constructor(private readonly lagProbe: ReplicaLagProbe) {}

  @Get()
  check(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('reporting-replica')
  checkReportingReplica(): {
    status: string;
    lag_seconds: number;
    mode: string;
    timestamp: string;
  } {
    if (!this.lagProbe.isHealthy()) {
      const freshness = this.lagProbe.getReplicaFreshness();
      throw new ServiceUnavailableException({
        code: 'REPORTING_REPLICA_UNAVAILABLE',
        lag_seconds: freshness.lagSeconds,
        timestamp: new Date().toISOString(),
      });
    }

    const freshness = this.lagProbe.getReplicaFreshness();
    return {
      status: 'ok',
      lag_seconds: freshness.lagSeconds,
      mode: freshness.isInRecovery ? 'replica' : 'standalone',
      timestamp: new Date().toISOString(),
    };
  }
}
