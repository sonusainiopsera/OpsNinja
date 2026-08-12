import { Module } from '@nestjs/common';

import { ReportingReplicaModule } from './infrastructure/reporting-replica.module';
import { ReportingService } from './reporting.service';
import { ReportDefinitionsRepository } from './report-definitions.repository';
import { ReportRunService } from './application/report-run.service';
import { ReportDefinitionService } from './application/report-definition.service';
import { SharingScopeResolver } from './application/sharing-scope.resolver';
import { ReportsController } from './api/reports.controller';

@Module({
  imports: [ReportingReplicaModule],
  controllers: [ReportsController],
  providers: [
    ReportingService,
    ReportDefinitionsRepository,
    ReportRunService,
    ReportDefinitionService,
    SharingScopeResolver,
  ],
  exports: [ReportingService, ReportDefinitionsRepository, ReportingReplicaModule],
})
export class ReportingModule {}
