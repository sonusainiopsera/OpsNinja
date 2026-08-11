import { Module } from '@nestjs/common';
import { SlaPoliciesController } from './sla-policies.controller';
import { SlaCalendarsController } from './sla-calendars.controller';
import { SlaPoliciesService } from './sla-policies.service';
import { SlaCalendarsService } from './sla-calendars.service';
import { SlaPoliciesRepository } from './sla-policies.repository';
import { SlaCalendarsRepository } from './sla-calendars.repository';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [SlaPoliciesController, SlaCalendarsController],
  providers: [
    SlaPoliciesService,
    SlaCalendarsService,
    SlaPoliciesRepository,
    SlaCalendarsRepository,
  ],
  exports: [SlaPoliciesService, SlaCalendarsService],
})
export class SlaModule {}
