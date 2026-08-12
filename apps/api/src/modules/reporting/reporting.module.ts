import { Module } from '@nestjs/common';

import { ReportingReplicaModule } from './infrastructure/reporting-replica.module';
import { ReportingService } from './reporting.service';
import { ReportDefinitionsRepository } from './report-definitions.repository';
import { ReportRunService } from './application/report-run.service';
import { ReportDefinitionService } from './application/report-definition.service';
import { SharingScopeResolver } from './application/sharing-scope.resolver';
import { ReportsController } from './api/reports.controller';
import { ExportsController } from './api/exports.controller';
import { ExportRequestService } from './application/export-request.service';
import { ExportJobsRepository } from './application/export-jobs.repository';
import { PresignedUrlService } from './application/presigned-url.service';

@Module({
  imports: [ReportingReplicaModule],
  controllers: [ReportsController, ExportsController],
  providers: [
    ReportingService,
    ReportDefinitionsRepository,
    ReportRunService,
    ReportDefinitionService,
    SharingScopeResolver,
    ExportRequestService,
    ExportJobsRepository,
    PresignedUrlService,
  ],
  exports: [ReportingService, ReportDefinitionsRepository, ReportingReplicaModule],
})
export class ReportingModule {}
