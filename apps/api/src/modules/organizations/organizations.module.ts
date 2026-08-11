import { Module } from '@nestjs/common';
import { AgentScopesController } from './agent-scopes.controller';
import { OrganizationsRepository } from './organizations.repository';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [IdentityModule],
  controllers: [AgentScopesController],
  providers: [OrganizationsRepository],
  exports: [OrganizationsRepository],
})
export class OrganizationsModule {}
