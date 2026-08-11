import { Module } from '@nestjs/common';

import { ReportingReplicaModule } from './infrastructure/reporting-replica.module';
import { ReportingService } from './reporting.service';
import { ReportDefinitionsRepository } from './report-definitions.repository';

@Module({
  imports: [ReportingReplicaModule],
  providers: [ReportingService, ReportDefinitionsRepository],
  exports: [ReportingService, ReportDefinitionsRepository, ReportingReplicaModule],
})
export class ReportingModule {}
