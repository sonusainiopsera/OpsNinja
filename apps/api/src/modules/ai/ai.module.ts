/**
 * AiModule — WO-063 / WO-064.
 *
 * Registers:
 *   AiPolicyService         — per-tenant AI settings and usage read/write
 *   AiAdminController       — GET/PUT settings, GET usage
 *   AiSynthesisAdminController — GET failed syntheses (WO-064 AC-9)
 *
 * Imports AuditModule so AuditWriter is available for policy mutation records.
 */

import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AiPolicyService } from './ai-policy.service';
import { AiAdminController } from './ai-admin.controller';
import { AiSynthesisAdminController } from './ai-synthesis-admin.controller';

@Module({
  imports:     [AuditModule],
  controllers: [AiAdminController, AiSynthesisAdminController],
  providers:   [AiPolicyService],
  exports:     [AiPolicyService],
})
export class AiModule {}
