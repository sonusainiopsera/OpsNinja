/**
 * ReportingReadReplicaModule
 *
 * Provides a dedicated node-postgres pool bound to the reporting read-replica,
 * entirely separate from the primary DbModule pool.
 *
 * DI token: REPORTING_DB  (distinct from DB_TOKEN = 'DRIZZLE_DB' in DbModule)
 *
 * Pool: max 8 connections, 5 s connection timeout, allowExitOnIdle false.
 * Credentials come from environment variables injected by Secrets Manager.
 *
 * An additional pool of max=1 is created exclusively for ReplicaLagProbe so
 * the probe never contends with application queries.
 */

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { ReportingDbClient } from './reporting-db.client';
import { TenantScopedReplicaRunner } from './tenant-scoped-replica.runner';
import { ReplicaLagProbe } from './replica-lag.probe';

export const REPORTING_DB = 'REPORTING_DRIZZLE_DB';

function buildReplicaPool(config: ConfigService, max: number): Pool {
  return new Pool({
    host: config.get<string>('REPORTING_REPLICA_HOST', 'localhost'),
    port: config.get<number>('REPORTING_REPLICA_PORT', 5432),
    database: config.get<string>('REPORTING_REPLICA_DB', 'opsninja'),
    user: config.get<string>('REPORTING_REPLICA_USER', 'opsninja_reporting'),
    password: config.get<string>('REPORTING_REPLICA_PASSWORD', ''),
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: false,
  });
}

@Module({
  providers: [
    {
      provide: ReportingDbClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ReportingDbClient =>
        new ReportingDbClient(buildReplicaPool(config, 8)),
    },
    {
      provide: REPORTING_DB,
      inject: [ReportingDbClient],
      useFactory: (client: ReportingDbClient) => client.db,
    },
    TenantScopedReplicaRunner,
    {
      provide: ReplicaLagProbe,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ReplicaLagProbe =>
        new ReplicaLagProbe(buildReplicaPool(config, 1)),
    },
  ],
  exports: [REPORTING_DB, ReportingDbClient, TenantScopedReplicaRunner, ReplicaLagProbe],
})
export class ReportingReadReplicaModule {}
