import { Module } from '@nestjs/common';

import { ReportingReplicaModule } from '../reporting/infrastructure/reporting-replica.module';

import { CsatTokenService } from './csat-token.service';
import { CsatRateLimiter } from './csat-rate-limiter';
import { CsatTokenGuard } from './csat-token.guard';
import { CsatService } from './csat.service';
import { CsatAggregationService } from './csat-aggregation.service';
import { CsatController } from './csat.controller';

@Module({
  imports: [ReportingReplicaModule],
  providers: [
    CsatTokenService,
    CsatRateLimiter,
    CsatTokenGuard,
    CsatService,
    CsatAggregationService,
  ],
  controllers: [CsatController],
  exports: [CsatTokenService],
})
export class CsatModule {}
