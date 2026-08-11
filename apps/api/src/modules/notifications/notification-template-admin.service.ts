import { Injectable } from '@nestjs/common';
import { notificationTemplates } from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';
import { gt, asc } from 'drizzle-orm';

interface ListOptions {
  cursor?: string;
  limit: number;
}

@Injectable()
export class NotificationTemplateAdminService extends TenantRepository {
  async listTemplates(options: ListOptions): Promise<{
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
    const limit = Math.min(options.limit, 100);

    const query = this.db
      .select({
        id: notificationTemplates.id,
        key: notificationTemplates.key,
        channel: notificationTemplates.channel,
        locale: notificationTemplates.locale,
        subject: notificationTemplates.subject,
        version: notificationTemplates.version,
        isActive: notificationTemplates.isActive,
      })
      .from(notificationTemplates)
      .orderBy(asc(notificationTemplates.id))
      .limit(limit + 1);

    const rows = await query;

    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit);

    return {
      data,
      cursor: hasMore && data.length > 0 ? (data[data.length - 1].id) : null,
    };
  }
}
