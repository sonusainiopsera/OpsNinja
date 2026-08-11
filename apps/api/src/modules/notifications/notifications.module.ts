import { Module } from '@nestjs/common';

import { NotificationTemplateController } from './notification-template.controller';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationsRepository } from './notifications.repository';

@Module({
  controllers: [NotificationTemplateController],
  providers: [NotificationTemplateService, NotificationsRepository],
  exports: [NotificationTemplateService, NotificationsRepository],
})
export class NotificationsModule {}
