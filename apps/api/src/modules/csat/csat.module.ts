import { Module } from '@nestjs/common';
import { CsatController } from './csat.controller';
import { CsatService } from './csat.service';
import { CsatAggregationService } from './csat-aggregation.service';
import { CsatTokenService } from './csat-token.service';
import { CsatTokenGuard } from './csat-token.guard';
import { ReportingReadReplicaModule } from '../reporting/infrastructure/reporting-replica.module';

@Module({
  imports: [ReportingReadReplicaModule],
  controllers: [CsatController],
  providers: [CsatService, CsatAggregationService, CsatTokenService, CsatTokenGuard],
  exports: [CsatTokenService],
})
export class CsatModule {}
