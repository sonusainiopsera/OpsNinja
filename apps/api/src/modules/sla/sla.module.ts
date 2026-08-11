import { Module } from '@nestjs/common';
import { SlaPoliciesController } from './sla-policies.controller';
import { SlaCalendarsController } from './sla-calendars.controller';
import { SlaPoliciesService } from './sla-policies.service';
import { SlaCalendarsService } from './sla-calendars.service';
import { SlaPoliciesRepository } from './sla-policies.repository';
import { SlaCalendarsRepository } from './sla-calendars.repository';
import { SlaTimersRepository } from './sla-timers.repository';
import { SlaPolicyResolver } from './sla-policy-resolver.service';
import { SlaService } from './sla.service';
import { SlaQueryService } from './sla-query.service';
import { SlaRealtimePublisher } from './sla-realtime-publisher.service';
import { RedisCacheService } from '../../infra/cache/redis-cache';
import { RedisModule } from '../../common/redis/redis.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule, RedisModule],
  controllers: [SlaPoliciesController, SlaCalendarsController],
  providers: [
    SlaPoliciesService,
    SlaCalendarsService,
    SlaPoliciesRepository,
    SlaCalendarsRepository,
    // WO-045: timer creation pipeline
    SlaTimersRepository,
    SlaPolicyResolver,
    SlaService,
    RedisCacheService,
    // WO-050: SLA read query service + realtime publisher
    SlaQueryService,
    SlaRealtimePublisher,
  ],
  exports: [
    SlaPoliciesService,
    SlaCalendarsService,
    // SlaService is the only cross-module entry point for timer operations.
    SlaService,
    // WO-050: exported for TicketSlaController in TicketsModule.
    SlaQueryService,
    SlaRealtimePublisher,
  ],
})
export class SlaModule {}
