import { Module } from '@nestjs/common';

import { ReportingReplicaModule } from '../modules/reporting/infrastructure/reporting-replica.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ReportingReplicaModule],
  controllers: [HealthController],
})
export class HealthModule {}
