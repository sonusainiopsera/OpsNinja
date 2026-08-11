import { Module } from '@nestjs/common';

import { REPORTING_DB, createReplicaPool } from './reporting-db.client';
import { ReplicaLagProbe } from './replica-lag.probe';
import { TenantScopedReplicaRunner } from './tenant-scoped-replica.runner';

@Module({
  providers: [
    {
      provide: REPORTING_DB,
      useFactory: () => createReplicaPool(),
    },
    TenantScopedReplicaRunner,
    ReplicaLagProbe,
  ],
  exports: [TenantScopedReplicaRunner, ReplicaLagProbe, REPORTING_DB],
})
export class ReportingReplicaModule {}
