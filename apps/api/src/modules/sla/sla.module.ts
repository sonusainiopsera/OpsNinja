import { Module } from '@nestjs/common';
import { SlaPoliciesController } from './sla-policies.controller';
import { SlaCalendarsController } from './sla-calendars.controller';
import { SlaPoliciesService } from './sla-policies.service';
import { SlaCalendarsService } from './sla-calendars.service';
import { SlaPoliciesRepository } from './sla-policies.repository';
import { SlaCalendarsRepository } from './sla-calendars.repository';
import { SlaDefaultsSeeder } from './sla-defaults.seed';

@Module({
  controllers: [SlaPoliciesController, SlaCalendarsController],
  providers: [
    SlaPoliciesService,
    SlaCalendarsService,
    SlaPoliciesRepository,
    SlaCalendarsRepository,
    SlaDefaultsSeeder,
  ],
  exports: [
    SlaPoliciesService,
    SlaCalendarsService,
    SlaPoliciesRepository,
    SlaCalendarsRepository,
    SlaDefaultsSeeder,
  ],
})
export class SlaModule {}
