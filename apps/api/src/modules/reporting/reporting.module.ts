import { Module } from '@nestjs/common';
import { ReportFilterService } from './report-filter.service';
import { ReportingReadReplicaModule } from './infrastructure/reporting-replica.module';
import { RowLimitGuard } from './infrastructure/guards/row-limit.guard';

@Module({
  imports: [ReportingReadReplicaModule],
  providers: [ReportFilterService, RowLimitGuard],
  exports: [ReportFilterService, ReportingReadReplicaModule, RowLimitGuard],
})
export class ReportingModule {}
