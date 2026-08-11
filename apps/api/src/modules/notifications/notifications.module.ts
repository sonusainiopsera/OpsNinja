import { Module } from '@nestjs/common';

import { NotificationTemplateController } from './notification-template.controller';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationsRepository } from './notifications.repository';
import { NotificationPreferencesRepository } from './notification-preferences.repository';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationRuleResolver } from './notification-rule.resolver';
import { SqsMessagePublisher, MESSAGE_PUBLISHER } from './message-publisher';
import {
  PortalNotificationPreferencesController,
  AdminNotificationDefaultsController,
} from './notification-preferences.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [
    NotificationTemplateController,
    PortalNotificationPreferencesController,
    AdminNotificationDefaultsController,
  ],
  providers: [
    NotificationTemplateService,
    NotificationsRepository,
    NotificationPreferencesRepository,
    NotificationPreferencesService,
    NotificationRuleResolver,
    {
      provide: MESSAGE_PUBLISHER,
      useClass: SqsMessagePublisher,
    },
    SqsMessagePublisher,
  ],
  exports: [
    NotificationTemplateService,
    NotificationsRepository,
    NotificationPreferencesService,
    NotificationRuleResolver,
    MESSAGE_PUBLISHER,
  ],
})
export class NotificationsModule {}
