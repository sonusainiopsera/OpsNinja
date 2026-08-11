import { Module } from '@nestjs/common';

import { AuthModule } from '../../common/auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { TicketRepository } from './repositories/ticket.repository';
import { CommentRepository } from './repositories/comment.repository';
import { AttachmentRepository } from './repositories/attachment.repository';
import { TenantSettingsRepository } from './repositories/tenant-settings.repository';
import { AttachmentAccessService } from './services/attachment-access.service';
import { PortalVisibilityGuard } from './portal/portal-visibility.guard';
import { PortalTicketsController } from './portal/portal-tickets.controller';
import { PortalAttachmentsController } from './portal/portal-attachments.controller';

@Module({
  imports: [AuthModule, AuditModule, OrganizationsModule],
  controllers: [PortalTicketsController, PortalAttachmentsController],
  providers: [
    TicketRepository,
    CommentRepository,
    AttachmentRepository,
    TenantSettingsRepository,
    AttachmentAccessService,
    PortalVisibilityGuard,
  ],
  exports: [
    TicketRepository,
    CommentRepository,
    AttachmentRepository,
    TenantSettingsRepository,
    AttachmentAccessService,
  ],
})
export class TicketsModule {}
