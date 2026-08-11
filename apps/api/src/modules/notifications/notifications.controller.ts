/**
 * NotificationsController – internal admin surface for notification templates.
 *
 * GET /api/v1/admin/notification-templates
 * Requires Admin role (permission: 'admin:notifications:read').
 * Returns a cursor-paginated list of template metadata.
 * Never returns body_template, text_template, or rendered bodies.
 */

import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { NotificationTemplateAdminService } from './notification-template-admin.service';

@Controller('api/v1/admin/notification-templates')
export class NotificationsController {
  constructor(private readonly adminService: NotificationTemplateAdminService) {}

  @Get()
  @RequirePermission('admin:notifications:read')
  async listTemplates(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<{
    data: Array<{
      id: string;
      key: string;
      channel: string;
      locale: string;
      subject: string;
      version: number;
      isActive: boolean;
    }>;
    cursor: string | null;
  }> {
    return this.adminService.listTemplates({
      cursor,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }
}
