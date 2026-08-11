import { Injectable } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { webhookEndpoints, type WebhookEndpoint, type NewWebhookEndpoint } from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';

@Injectable()
export class WebhookEndpointsRepository extends TenantRepository {
  async insert(data: NewWebhookEndpoint): Promise<WebhookEndpoint> {
    const rows = await this.tx
      .insert(webhookEndpoints)
      .values(data)
      .returning();
    return rows[0]!;
  }

  async findById(tenantId: string, id: string): Promise<WebhookEndpoint | null> {
    const rows = await this.tx
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.tenantId, tenantId),
          eq(webhookEndpoints.id, id),
          isNull(webhookEndpoints.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findPage(
    tenantId: string,
    limit: number,
    cursor?: string,
  ): Promise<WebhookEndpoint[]> {
    const conditions = [
      eq(webhookEndpoints.tenantId, tenantId),
      isNull(webhookEndpoints.deletedAt),
    ];
    if (cursor) {
      // Cursor is the id of the last item from the previous page.
      // Simple lexicographic cursor on uuid — sufficient for webhook management
      // which is low-volume.
      conditions.push(eq(webhookEndpoints.id, cursor));
    }
    return this.tx
      .select()
      .from(webhookEndpoints)
      .where(and(...conditions))
      .limit(limit + 1);
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<Omit<NewWebhookEndpoint, 'tenantId' | 'id'>>,
  ): Promise<WebhookEndpoint | null> {
    const rows = await this.tx
      .update(webhookEndpoints)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(webhookEndpoints.tenantId, tenantId),
          eq(webhookEndpoints.id, id),
          isNull(webhookEndpoints.deletedAt),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const rows = await this.tx
      .update(webhookEndpoints)
      .set({ deletedAt: new Date(), status: 'deleted', updatedAt: new Date() })
      .where(
        and(
          eq(webhookEndpoints.tenantId, tenantId),
          eq(webhookEndpoints.id, id),
          isNull(webhookEndpoints.deletedAt),
        ),
      )
      .returning({ id: webhookEndpoints.id });
    return rows.length > 0;
  }
}
