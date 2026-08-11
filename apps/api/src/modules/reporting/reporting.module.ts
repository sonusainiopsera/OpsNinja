import { Module } from '@nestjs/common';

import { ReportingReplicaModule } from './infrastructure/reporting-replica.module';
import { ReportingService } from './reporting.service';

@Module({
  imports: [ReportingReplicaModule],
  providers: [ReportingService],
  exports: [ReportingService, ReportingReplicaModule],
})
export class ReportingModule {}
