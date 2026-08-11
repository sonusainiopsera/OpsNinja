import { Module } from '@nestjs/common';

import { AuthModule } from '../../common/auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AgentScopesController } from './agent-scopes.controller';
import { AgentScopesService } from './agent-scopes.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrganizationsRepository } from './organizations.repository';
import { ContactsController } from './contacts/contacts.controller';
import { ContactsService } from './contacts/contacts.service';
import { ContactsRepository } from './contacts/contacts.repository';
import { ContactImportService } from './contacts/contact-import.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AgentScopesController, OrganizationsController, ContactsController],
  providers: [
    AgentScopesService,
    OrganizationsService,
    OrganizationsRepository,
    ContactsService,
    ContactsRepository,
    ContactImportService,
  ],
  exports: [AgentScopesService, OrganizationsService, ContactsService],
})
export class OrganizationsModule {}
