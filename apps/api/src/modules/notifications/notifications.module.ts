import { Module } from '@nestjs/common';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationsRepository } from './repositories/notifications.repository';
import { NotificationsController } from './notifications.controller';
import { NotificationTemplateAdminService } from './notification-template-admin.service';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationTemplateService,
    NotificationsRepository,
    NotificationTemplateAdminService,
  ],
  exports: [NotificationTemplateService, NotificationsRepository],
})
export class NotificationsModule {}
