import { Module } from '@nestjs/common';

import { AuthModule } from '../../common/auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AgentScopesController } from './agent-scopes.controller';
import { AgentScopesService } from './agent-scopes.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrganizationsRepository } from './organizations.repository';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AgentScopesController, OrganizationsController],
  providers: [AgentScopesService, OrganizationsService, OrganizationsRepository],
  exports: [AgentScopesService, OrganizationsService],
})
export class OrganizationsModule {}
