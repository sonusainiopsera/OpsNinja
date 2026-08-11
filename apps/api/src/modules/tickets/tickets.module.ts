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
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { CommentsController } from './comments/comments.controller';
import { CommentsService } from './comments/comments.service';
import { AuditWriter } from '../audit/audit-writer';
import { AttachmentsController, AttachmentDownloadController } from './attachments/attachments.controller';
import { AttachmentsService } from './attachments/attachments.service';
import { S3ObjectStore } from './attachments/storage/s3-object-store';
import { OBJECT_STORE_PORT } from './attachments/storage/object-store.port';

@Module({
  imports: [AuthModule, AuditModule, OrganizationsModule, ViewsModule],
  controllers: [
    PortalTicketsController,
    PortalAttachmentsController,
    QueueController,
    TicketsController,                 // WO-032: POST /tickets, GET /tickets/:id, PATCH /:id, POST /:id/resolve
    CommentsController,                // WO-034: POST /tickets/:id/comments, GET /tickets/:id/comments
    AttachmentsController,             // WO-035: POST /tickets/:id/attachments/presign, POST .../finalize
    AttachmentDownloadController,      // WO-035: GET /attachments/:id/download
  ],
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
    // Ticket CRUD (WO-032) + lifecycle (WO-033)
    TicketsController,
    TicketsService,
    AuditWriter,
    // Comments (WO-034)
    CommentsController,
    CommentsService,
    // Attachments (WO-035)
    AttachmentsService,
    { provide: OBJECT_STORE_PORT, useClass: S3ObjectStore },
    S3ObjectStore,
  ],
  exports: [
    TicketRepository,
    CommentRepository,
    AttachmentRepository,
    TenantSettingsRepository,
    AttachmentAccessService,
    QueueService,
    TicketsService,
    CommentsService,
    AttachmentsService,
  ],
})
export class TicketsModule {}
