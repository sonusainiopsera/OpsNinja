import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ReportingModule } from '../modules/reporting/reporting.module';

@Module({
  imports: [ReportingModule],
  controllers: [HealthController],
})
export class HealthModule {}
