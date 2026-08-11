import { Module } from '@nestjs/common';

import { ReportingService } from './reporting.service';

@Module({
  providers: [ReportingService],
  exports: [ReportingService],
})
export class ReportingModule {}
