/**
 * JiraMappingRepository — data access for jira_project_mappings.
 *
 * Extends TenantRepository so all queries run inside the RLS-bound tenant
 * transaction. Write methods carry @Auditable so mapping changes are recorded.
 */

import { Injectable } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import {
  jiraProjectMappings,
  type JiraProjectMapping,
  type NewJiraProjectMapping,
} from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { Auditable } from '../../audit/auditable.decorator';

@Injectable()
export class JiraMappingRepository extends TenantRepository {
  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async findById(tenantId: string, id: string): Promise<JiraProjectMapping | null> {
    const rows = await this.tx
      .select()
      .from(jiraProjectMappings)
      .where(and(eq(jiraProjectMappings.tenantId, tenantId), eq(jiraProjectMappings.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByConnection(
    tenantId: string,
    connectionId: string,
  ): Promise<JiraProjectMapping[]> {
    return this.tx
      .select()
      .from(jiraProjectMappings)
      .where(
        and(
          eq(jiraProjectMappings.tenantId, tenantId),
          eq(jiraProjectMappings.connectionId, connectionId),
        ),
      )
      .orderBy(jiraProjectMappings.createdAt);
  }

  async findDefault(
    tenantId: string,
    connectionId: string,
  ): Promise<JiraProjectMapping | null> {
    const rows = await this.tx
      .select()
      .from(jiraProjectMappings)
      .where(
        and(
          eq(jiraProjectMappings.tenantId, tenantId),
          eq(jiraProjectMappings.connectionId, connectionId),
          eq(jiraProjectMappings.isDefault, true),
          eq(jiraProjectMappings.enabled, true),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findEnabled(
    tenantId: string,
    connectionId?: string,
  ): Promise<JiraProjectMapping[]> {
    const conditions: ReturnType<typeof eq>[] = [
      eq(jiraProjectMappings.tenantId, tenantId),
      eq(jiraProjectMappings.enabled, true),
    ];
    if (connectionId) {
      conditions.push(eq(jiraProjectMappings.connectionId, connectionId));
    }
    return this.tx
      .select()
      .from(jiraProjectMappings)
      .where(and(...conditions))
      .orderBy(jiraProjectMappings.isDefault, jiraProjectMappings.createdAt);
  }

  async findPaginated(
    tenantId: string,
    limit: number,
    cursor?: string,
    connectionId?: string,
  ): Promise<JiraProjectMapping[]> {
    const conditions: ReturnType<typeof eq | typeof and>[] = [
      eq(jiraProjectMappings.tenantId, tenantId),
    ];
    if (connectionId) {
      conditions.push(eq(jiraProjectMappings.connectionId, connectionId));
    }
    if (cursor) {
      conditions.push(sql`${jiraProjectMappings.id} > ${cursor}`);
    }
    return this.tx
      .select()
      .from(jiraProjectMappings)
      .where(and(...conditions))
      .orderBy(jiraProjectMappings.id)
      .limit(limit);
  }

  // --------------------------------------------------------------------------
  // Writes
  // --------------------------------------------------------------------------

  @Auditable({ resourceType: 'jira_project_mapping', action: 'create' })
  async create(data: NewJiraProjectMapping): Promise<JiraProjectMapping> {
    const rows = await this.tx
      .insert(jiraProjectMappings)
      .values(data)
      .returning();
    return rows[0]!;
  }

  @Auditable({ resourceType: 'jira_project_mapping', action: 'update', resourceIdArg: 1 })
  async update(
    tenantId: string,
    id: string,
    patch: Partial<Omit<NewJiraProjectMapping, 'tenantId' | 'id' | 'createdAt'>>,
  ): Promise<JiraProjectMapping | null> {
    const rows = await this.tx
      .update(jiraProjectMappings)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(jiraProjectMappings.tenantId, tenantId), eq(jiraProjectMappings.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  /** Clear is_default on all mappings for a connection (used in same-transaction default rotation). */
  async clearDefault(tenantId: string, connectionId: string): Promise<void> {
    await this.tx
      .update(jiraProjectMappings)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(jiraProjectMappings.tenantId, tenantId),
          eq(jiraProjectMappings.connectionId, connectionId),
          eq(jiraProjectMappings.isDefault, true),
        ),
      );
  }

  @Auditable({ resourceType: 'jira_project_mapping', action: 'delete', resourceIdArg: 1 })
  async delete(tenantId: string, id: string): Promise<boolean> {
    const rows = await this.tx
      .delete(jiraProjectMappings)
      .where(and(eq(jiraProjectMappings.tenantId, tenantId), eq(jiraProjectMappings.id, id)))
      .returning({ id: jiraProjectMappings.id });
    return rows.length > 0;
  }
}
