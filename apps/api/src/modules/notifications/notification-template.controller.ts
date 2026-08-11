/**
 * NotificationTemplateController — internal admin read endpoint.
 *
 * GET /api/v1/admin/notification-templates
 *   Returns template metadata (no rendered bodies, no secrets).
 *   Requires the Admin role via @RequirePermission.
 *   Supports cursor-based pagination (cursor = last tenantId+key).
 */

import { Controller, Get, Query } from '@nestjs/common';
import { eq, and, gt } from 'drizzle-orm';

import { notificationTemplates } from '@opsninja/db';
import { getTxHandle } from '../../data/tenant-repository';
import { getPrincipalContext } from '../../observability/request-context';
import { RequirePermission } from '../../common/auth/require-permission.decorator';

const PAGE_SIZE = 50;

@Controller('admin/notification-templates')
export class NotificationTemplateController {
  @Get()
  @RequirePermission('admin:notifications:read')
  async listTemplates(
    @Query('cursor') cursor?: string,
  ): Promise<{
    data: Array<{
      key: string;
      channel: string;
      locale: string;
      subject: string;
      version: number;
      isActive: boolean;
    }>;
    cursor: string | null;
  }> {
    const tx = getTxHandle();
    const { tenantId } = getPrincipalContext();

    const rows = await tx
      .select({
        key: notificationTemplates.key,
        channel: notificationTemplates.channel,
        locale: notificationTemplates.locale,
        subject: notificationTemplates.subject,
        version: notificationTemplates.version,
        isActive: notificationTemplates.isActive,
      })
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.tenantId, tenantId),
          cursor ? gt(notificationTemplates.key, cursor) : undefined,
        ),
      )
      .orderBy(notificationTemplates.key)
      .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const data = rows.slice(0, PAGE_SIZE);
    const nextCursor = hasMore ? (data[data.length - 1]?.key ?? null) : null;

    return { data, cursor: nextCursor };
  }
}
