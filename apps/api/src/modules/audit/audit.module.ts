/**
 * AuditModule — owns mutation audit writing (WO-093) and read-side query
 * surface (WO-096).
 *
 * Imports ReportingReplicaModule to get TenantScopedReplicaRunner for
 * AuditQueryService (reads execute on the read replica with a 30s
 * statement_timeout).
 */

import { Module } from '@nestjs/common';
import { AuditWriter } from './audit-writer';
import { DefaultRedactor, REDACTION_PORT } from './redaction.port';
import { AuditQueryService } from './audit-query.service';
import { AuditController } from './audit.controller';
import { ReportingReplicaModule } from '../reporting/infrastructure/reporting-replica.module';

@Module({
  imports: [ReportingReplicaModule],
  controllers: [AuditController],
  providers: [
    AuditWriter,
    AuditQueryService,
    {
      provide: REDACTION_PORT,
      useClass: DefaultRedactor,
    },
  ],
  exports: [AuditWriter, AuditQueryService],
})
export class AuditModule {}
