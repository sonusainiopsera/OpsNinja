import { Injectable } from '@nestjs/common';
import { and, eq, desc, sql } from 'drizzle-orm';
import { webhookDeliveries } from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';

export interface ListDeliveriesQuery {
  endpointId: string;
  tenantId: string;
  limit: number;
  cursor?: string;
  status?: string;
}

export interface DeliveryRow {
  id: string;
  tenantId: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  attempt: number;
  status: string;
  httpStatus: number | null;
  latencyMs: number | null;
  responseSnippet: string | null;
  errorCode: string | null;
  canonicalPayload: Record<string, unknown>;
  createdAt: Date;
}

@Injectable()
export class WebhookDeliveriesRepository extends TenantRepository {
  async findByEndpoint(params: ListDeliveriesQuery): Promise<DeliveryRow[]> {
    const conditions = [
      eq(webhookDeliveries.tenantId, params.tenantId),
      eq(webhookDeliveries.endpointId, params.endpointId),
    ];

    if (params.cursor) {
      conditions.push(
        sql`${webhookDeliveries.createdAt} < (SELECT created_at FROM webhook_deliveries WHERE tenant_id = ${params.tenantId} AND id = ${params.cursor} LIMIT 1)`,
      );
    }

    if (params.status) {
      conditions.push(eq(webhookDeliveries.status, params.status as 'delivered' | 'failed' | 'dropped' | 'pending'));
    }

    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(and(...conditions))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(params.limit + 1);

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      endpointId: r.endpointId,
      eventId: r.eventId,
      eventType: r.eventType,
      attempt: r.attempt,
      status: r.status,
      httpStatus: r.httpStatus ?? null,
      latencyMs: r.latencyMs ?? null,
      responseSnippet: r.responseSnippet ?? null,
      errorCode: r.errorCode ?? null,
      canonicalPayload: (r.canonicalPayload as Record<string, unknown>) ?? {},
      createdAt: r.createdAt,
    }));
  }

  async findById(tenantId: string, deliveryId: string): Promise<DeliveryRow | undefined> {
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(and(
        eq(webhookDeliveries.tenantId, tenantId),
        eq(webhookDeliveries.id, deliveryId),
      ))
      .limit(1);

    if (rows.length === 0) return undefined;
    const r = rows[0];
    return {
      id: r.id,
      tenantId: r.tenantId,
      endpointId: r.endpointId,
      eventId: r.eventId,
      eventType: r.eventType,
      attempt: r.attempt,
      status: r.status,
      httpStatus: r.httpStatus ?? null,
      latencyMs: r.latencyMs ?? null,
      responseSnippet: r.responseSnippet ?? null,
      errorCode: r.errorCode ?? null,
      canonicalPayload: (r.canonicalPayload as Record<string, unknown>) ?? {},
      createdAt: r.createdAt,
    };
  }

  async getNextAttemptNumber(tenantId: string, endpointId: string, eventId: string): Promise<number> {
    const rows = await this.db
      .select({ attempt: webhookDeliveries.attempt })
      .from(webhookDeliveries)
      .where(and(
        eq(webhookDeliveries.tenantId, tenantId),
        eq(webhookDeliveries.endpointId, endpointId),
        eq(webhookDeliveries.eventId, eventId),
      ))
      .orderBy(desc(webhookDeliveries.attempt))
      .limit(1);

    return (rows[0]?.attempt ?? 0) + 1;
  }

}
