import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq, and, gt, asc, sql } from 'drizzle-orm';
import { webhookEndpoints, auditLogs } from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';

export interface CreateEndpointParams {
  tenantId: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  secretCiphertext: Buffer;
  secretKeyVersion: number;
  createdBy: string;
}

export interface UpdateEndpointParams {
  url?: string;
  description?: string | null;
  eventTypes?: string[];
  secretCiphertext?: Buffer;
  secretKeyVersion?: number;
  previousSecretCiphertext?: Buffer | null;
  previousSecretExpiresAt?: Date | null;
  status?: 'active' | 'disabled' | 'auto_disabled';
  consecutiveFailures?: number;
  lastSuccessAt?: Date | null;
}

export interface WebhookEndpointRow {
  id: string;
  tenantId: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  status: string;
  secretCiphertext: Buffer;
  secretKeyVersion: number;
  previousSecretCiphertext: Buffer | null;
  previousSecretExpiresAt: Date | null;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface AuditRecord {
  tenantId: string;
  actorId: string;
  action: string;
  resourceId: string;
  details: Record<string, unknown>;
  occurredAt: Date;
}

@Injectable()
export class WebhookEndpointsRepository extends TenantRepository {
  async create(params: CreateEndpointParams): Promise<WebhookEndpointRow> {
    const id = randomUUID();
    const now = new Date();
    const rows = await this.db
      .insert(webhookEndpoints)
      .values({
        id,
        tenantId: params.tenantId,
        url: params.url,
        description: params.description,
        eventTypes: params.eventTypes,
        status: 'active',
        secretCiphertext: params.secretCiphertext,
        secretKeyVersion: params.secretKeyVersion,
        previousSecretCiphertext: null,
        previousSecretExpiresAt: null,
        consecutiveFailures: 0,
        lastSuccessAt: null,
        createdBy: params.createdBy,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .returning();
    return rows[0] as unknown as WebhookEndpointRow;
  }

  async findById(tenantId: string, id: string): Promise<WebhookEndpointRow | null> {
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.tenantId, tenantId),
          eq(webhookEndpoints.id, id),
          sql`${webhookEndpoints.deletedAt} IS NULL`,
        ),
      )
      .limit(1);
    return (rows[0] ?? null) as WebhookEndpointRow | null;
  }

  async findPage(
    tenantId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ rows: WebhookEndpointRow[]; nextCursor: string | null }> {
    const conditions = [
      eq(webhookEndpoints.tenantId, tenantId),
      sql`${webhookEndpoints.deletedAt} IS NULL`,
    ];
    if (cursor) {
      conditions.push(gt(webhookEndpoints.id, cursor));
    }
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .where(and(...conditions))
      .orderBy(asc(webhookEndpoints.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;
    return { rows: page as unknown as WebhookEndpointRow[], nextCursor };
  }

  async update(
    tenantId: string,
    id: string,
    params: UpdateEndpointParams,
  ): Promise<WebhookEndpointRow | null> {
    const rows = await this.db
      .update(webhookEndpoints)
      .set({
        ...params,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(webhookEndpoints.tenantId, tenantId),
          eq(webhookEndpoints.id, id),
          sql`${webhookEndpoints.deletedAt} IS NULL`,
        ),
      )
      .returning();
    return (rows[0] ?? null) as WebhookEndpointRow | null;
  }

  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .update(webhookEndpoints)
      .set({ deletedAt: new Date(), updatedAt: new Date(), status: 'disabled' })
      .where(
        and(
          eq(webhookEndpoints.tenantId, tenantId),
          eq(webhookEndpoints.id, id),
          sql`${webhookEndpoints.deletedAt} IS NULL`,
        ),
      )
      .returning({ id: webhookEndpoints.id });
    return rows.length > 0;
  }

  async writeAudit(record: AuditRecord): Promise<void> {
    await this.db.insert(auditLogs).values({
      id: randomUUID(),
      tenantId: record.tenantId,
      actorId: record.actorId,
      actorKind: 'user',
      action: record.action,
      resourceType: 'webhook_endpoint',
      resourceId: record.resourceId,
      requiredPermission: null,
      route: null,
      outcome: 'success',
      code: record.action,
      traceId: null,
      metadata: record.details,
      occurredAt: record.occurredAt,
    });
  }
}
