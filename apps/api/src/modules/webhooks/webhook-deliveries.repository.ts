import { Injectable } from '@nestjs/common';
import { and, eq, lt, desc } from 'drizzle-orm';
import * as schema from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';

export interface DeliveryPage {
  data: schema.WebhookDelivery[];
  cursor: string | null;
}

@Injectable()
export class WebhookDeliveriesRepository extends TenantRepository {
  async listByEndpoint(
    endpointId: string,
    limit: number,
    cursor?: string,
    status?: schema.WebhookDeliveryStatus,
  ): Promise<DeliveryPage> {
    const conditions = [
      eq(schema.webhookDeliveries.endpointId, endpointId),
    ];
    if (status) conditions.push(eq(schema.webhookDeliveries.status, status));
    if (cursor) {
      const cursorDate = new Date(Buffer.from(cursor, 'base64url').toString());
      if (!isNaN(cursorDate.getTime())) {
        conditions.push(lt(schema.webhookDeliveries.createdAt, cursorDate));
      }
    }

    const rows = await this.tx
      .select()
      .from(schema.webhookDeliveries)
      .where(and(...conditions))
      .orderBy(desc(schema.webhookDeliveries.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit);
    const nextCursor =
      hasMore && data.length > 0
        ? Buffer.from(data[data.length - 1].createdAt.toISOString()).toString('base64url')
        : null;

    return { data, cursor: nextCursor };
  }

  async findById(deliveryId: string): Promise<schema.WebhookDelivery | null> {
    const rows = await this.tx
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.id, deliveryId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getNextAttemptNumber(
    endpointId: string,
    eventId: string,
  ): Promise<number> {
    const rows = await this.tx
      .select({ attempt: schema.webhookDeliveries.attempt })
      .from(schema.webhookDeliveries)
      .where(
        and(
          eq(schema.webhookDeliveries.endpointId, endpointId),
          eq(schema.webhookDeliveries.eventId, eventId),
        ),
      )
      .orderBy(desc(schema.webhookDeliveries.attempt))
      .limit(1);
    return (rows[0]?.attempt ?? 0) + 1;
  }
}
