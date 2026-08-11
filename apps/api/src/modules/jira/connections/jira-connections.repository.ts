/**
 * JiraConnectionsRepository — data access for jira_connections.
 *
 * Uses TenantRepository so all queries run inside the RLS-bound tenant
 * transaction. Write methods are decorated with @Auditable.
 */

import { Injectable } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import {
  jiraConnections,
  type JiraConnection,
  type NewJiraConnection,
} from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { Auditable } from '../../audit/auditable.decorator';

@Injectable()
export class JiraConnectionsRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async findById(tenantId: string, id: string): Promise<JiraConnection | null> {
    const rows = await this.tx
      .select()
      .from(jiraConnections)
      .where(and(eq(jiraConnections.tenantId, tenantId), eq(jiraConnections.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByCloudId(cloudId: string): Promise<JiraConnection | null> {
    const rows = await this.tx
      .select()
      .from(jiraConnections)
      .where(eq(jiraConnections.cloudId, cloudId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findPaginated(tenantId: string, limit: number, cursor?: string): Promise<JiraConnection[]> {
    const conditions = [eq(jiraConnections.tenantId, tenantId)];
    if (cursor) {
      conditions.push(sql`${jiraConnections.id} > ${cursor}`);
    }
    return this.tx
      .select()
      .from(jiraConnections)
      .where(and(...conditions))
      .orderBy(jiraConnections.id)
      .limit(limit);
  }

  // --------------------------------------------------------------------------
  // Writes
  // --------------------------------------------------------------------------

  @Auditable({ resourceType: 'jira_connection', action: 'create' })
  async create(data: NewJiraConnection): Promise<JiraConnection> {
    const rows = await this.tx
      .insert(jiraConnections)
      .values(data)
      .returning();
    return rows[0]!;
  }

  @Auditable({ resourceType: 'jira_connection', action: 'update', resourceIdArg: 1 })
  async update(
    tenantId: string,
    id: string,
    patch: Partial<Omit<NewJiraConnection, 'tenantId' | 'id' | 'createdAt'>>,
  ): Promise<JiraConnection | null> {
    const rows = await this.tx
      .update(jiraConnections)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(jiraConnections.tenantId, tenantId), eq(jiraConnections.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  /** Update state and token metadata — used by token refresh path; not separately auditable. */
  async updateState(
    tenantId: string,
    id: string,
    patch: { secretRef?: string; tokenExpiresAt?: Date; state?: string },
  ): Promise<void> {
    await this.tx
      .update(jiraConnections)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(jiraConnections.tenantId, tenantId), eq(jiraConnections.id, id)));
  }

  @Auditable({ resourceType: 'jira_connection', action: 'revoke', resourceIdArg: 1 })
  async revoke(tenantId: string, id: string): Promise<JiraConnection | null> {
    const rows = await this.tx
      .update(jiraConnections)
      .set({ state: 'revoked', updatedAt: new Date() })
      .where(and(eq(jiraConnections.tenantId, tenantId), eq(jiraConnections.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  /** Update webhook secret reference and rotation timestamp (WO-058). */
  async updateWebhookSecret(
    tenantId: string,
    id: string,
    patch: { webhookSecretRef: string; webhookSecretRotatedAt: Date },
  ): Promise<void> {
    await this.tx
      .update(jiraConnections)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(jiraConnections.tenantId, tenantId), eq(jiraConnections.id, id)));
  }

  /**
   * List all connections for a tenant (WO-058 health aggregation).
   * Returns data array with optional nextCursor for pagination.
   */
  async list(
    tenantId: string,
    limit = 50,
    cursor?: string,
  ): Promise<{ data: JiraConnection[]; nextCursor: string | null }> {
    const fetchLimit = Math.min(limit, 100);
    const rows = await this.findPaginated(tenantId, fetchLimit + 1, cursor);
    const hasMore = rows.length > fetchLimit;
    const data = hasMore ? rows.slice(0, fetchLimit) : rows;
    return { data, nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null };
  }
}
