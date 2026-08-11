import { Module } from '@nestjs/common';

import { AuthModule } from '../../common/auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AgentScopesController } from './agent-scopes.controller';
import { AgentScopesService } from './agent-scopes.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AgentScopesController],
  providers: [AgentScopesService],
  exports: [AgentScopesService],
})
export class OrganizationsModule {}
