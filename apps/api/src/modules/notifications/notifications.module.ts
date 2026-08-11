import { Module, forwardRef } from '@nestjs/common';

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
import { AuthModule } from '../../common/auth/auth.module';
import { AuditService } from '../../common/auth/audit.service';
import { PortalVisibilityGuard } from '../tickets/portal/portal-visibility.guard';

@Module({
  imports: [AuditModule, forwardRef(() => AuthModule)],
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
    AuditService,
    PortalVisibilityGuard,
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
