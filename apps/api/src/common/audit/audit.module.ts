import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditWriter } from './audit-writer';
import { AuditInterceptor } from './audit.interceptor';
import { DefaultRedactor, REDACTION_PORT } from './redaction.port';

@Global()
@Module({
  providers: [
    AuditService,
    AuditWriter,
    AuditInterceptor,
    {
      provide: REDACTION_PORT,
      useClass: DefaultRedactor,
    },
  ],
  exports: [AuditService, AuditWriter, AuditInterceptor],
})
export class AuditModule {}
