import { Module } from '@nestjs/common';
import { ReportFilterService } from './report-filter.service';

@Module({
  providers: [ReportFilterService],
  exports: [ReportFilterService],
})
export class ReportingModule {}
