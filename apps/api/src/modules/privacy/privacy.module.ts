/**
 * PrivacyModule — WO-096.
 *
 * Owns the GDPR data-subject rights lifecycle (access, portability,
 * rectification, erasure) and the subject-export manifest.
 *
 * Imports AuditModule for AuditWriter so subject-request mutations are
 * themselves audited.
 */

import { Module } from '@nestjs/common';
import { SubjectRequestsController } from './subject-requests.controller';
import { SubjectRequestService } from './subject-request.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [SubjectRequestsController],
  providers: [SubjectRequestService],
  exports: [SubjectRequestService],
})
export class PrivacyModule {}
