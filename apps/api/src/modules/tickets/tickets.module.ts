import { Module } from '@nestjs/common';

import { AuthModule } from '../../common/auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ViewsModule } from '../views/views.module';
import { TicketRepository } from './repositories/ticket.repository';
import { CommentRepository } from './repositories/comment.repository';
import { AttachmentRepository } from './repositories/attachment.repository';
import { TenantSettingsRepository } from './repositories/tenant-settings.repository';
import { AttachmentAccessService } from './services/attachment-access.service';
import { PortalVisibilityGuard } from './portal/portal-visibility.guard';
import { PortalTicketsController } from './portal/portal-tickets.controller';
import { PortalAttachmentsController } from './portal/portal-attachments.controller';
import { QueueController } from './queue/queue.controller';
import { QueueService } from './queue/queue.service';
import { QueueRepository } from './queue/queue.repository';
import { RedisCacheService } from '../../infra/cache/redis-cache';

@Module({
  imports: [AuthModule, AuditModule, OrganizationsModule, ViewsModule],
  controllers: [PortalTicketsController, PortalAttachmentsController, QueueController],
  providers: [
    TicketRepository,
    CommentRepository,
    AttachmentRepository,
    TenantSettingsRepository,
    AttachmentAccessService,
    PortalVisibilityGuard,
    // Queue (WO-040)
    QueueController,
    QueueService,
    QueueRepository,
    RedisCacheService,
  ],
  exports: [
    TicketRepository,
    CommentRepository,
    AttachmentRepository,
    TenantSettingsRepository,
    AttachmentAccessService,
    QueueService,
  ],
})
export class TicketsModule {}
