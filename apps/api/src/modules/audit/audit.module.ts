import { Module } from '@nestjs/common';
import { AuditWriter } from './audit-writer';
import { DefaultRedactor, REDACTION_PORT } from './redaction.port';

@Module({
  providers: [
    AuditWriter,
    {
      provide: REDACTION_PORT,
      useClass: DefaultRedactor,
    },
  ],
  exports: [AuditWriter],
})
export class AuditModule {}
