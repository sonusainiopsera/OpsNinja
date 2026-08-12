import { Module, forwardRef } from '@nestjs/common';

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
import { CustomFieldDefsService } from './custom-fields/custom-field-defs.service';
import { CustomFieldDefsRepository } from './custom-fields/custom-field-defs.repository';
import { VerifiedDomainsService } from './verified-domains/verified-domains.service';
import { VerifiedDomainsRepository } from './verified-domains/verified-domains.repository';
import { DomainOwnershipVerifier } from './verified-domains/domain-ownership.verifier';
import { OrganizationChangeRequestsService } from './organization-change-requests.service';

@Module({
  imports: [forwardRef(() => AuthModule), AuditModule],
  controllers: [AgentScopesController, OrganizationsController, ContactsController],
  providers: [
    AgentScopesService,
    OrganizationsService,
    OrganizationsRepository,
    ContactsService,
    ContactsRepository,
    ContactImportService,
    CustomFieldDefsService,
    CustomFieldDefsRepository,
    VerifiedDomainsService,
    VerifiedDomainsRepository,
    DomainOwnershipVerifier,
    OrganizationChangeRequestsService,
  ],
  exports: [
    AgentScopesService,
    OrganizationsService,
    ContactsService,
    VerifiedDomainsService,
    OrganizationChangeRequestsService,
  ],
})
export class OrganizationsModule {}
