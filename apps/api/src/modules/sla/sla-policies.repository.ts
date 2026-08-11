/**
 * SlaPoliciesRepository — data access for sla_policies and sla_policy_versions.
 *
 * Extends TenantRepository so every query runs inside the RLS-bound tenant
 * transaction. All write methods are decorated with @Auditable.
 */

import { Injectable } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import {
  slaPolicies,
  slaPolicyVersions,
  type SlaPolicy,
  type NewSlaPolicy,
  type SlaPolicyVersion,
} from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';
import { Auditable } from '../audit/auditable.decorator';

@Injectable()
export class SlaPoliciesRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async findById(tenantId: string, id: string): Promise<SlaPolicy | null> {
    const rows = await this.tx
      .select()
      .from(slaPolicies)
      .where(and(eq(slaPolicies.tenantId, tenantId), eq(slaPolicies.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findPaginated(
    tenantId: string,
    limit: number,
    cursor?: string,
  ): Promise<SlaPolicy[]> {
    const conditions = [eq(slaPolicies.tenantId, tenantId)];
    if (cursor) {
      conditions.push(sql`${slaPolicies.id} > ${cursor}`);
    }
    return this.tx
      .select()
      .from(slaPolicies)
      .where(and(...conditions))
      .orderBy(slaPolicies.id)
      .limit(limit);
  }

  /**
   * Find a single active policy matching the given scope and priority.
   * Used by SlaPolicyResolver for timer creation.
   */
  async findActiveByScope(
    tenantId: string,
    scopeType: string,
    scopeId: string | null,
    priority: string,
  ): Promise<SlaPolicy | null> {
    const conditions = [
      eq(slaPolicies.tenantId, tenantId),
      eq(slaPolicies.scopeType, scopeType),
      eq(slaPolicies.priority, priority),
      eq(slaPolicies.isActive, true),
    ];

    if (scopeId !== null) {
      conditions.push(eq(slaPolicies.scopeId, scopeId));
    } else {
      conditions.push(sql`${slaPolicies.scopeId} IS NULL`);
    }

    const rows = await this.tx
      .select()
      .from(slaPolicies)
      .where(and(...conditions))
      .limit(1);

    return rows[0] ?? null;
  }

  async findVersionsByPolicyId(tenantId: string, policyId: string): Promise<SlaPolicyVersion[]> {
    return this.tx
      .select()
      .from(slaPolicyVersions)
      .where(
        and(
          eq(slaPolicyVersions.tenantId, tenantId),
          eq(slaPolicyVersions.policyId, policyId),
        ),
      )
      .orderBy(slaPolicyVersions.version);
  }

  // --------------------------------------------------------------------------
  // Writes
  // --------------------------------------------------------------------------

  @Auditable({ resourceType: 'sla_policy', action: 'create' })
  async create(data: NewSlaPolicy): Promise<SlaPolicy> {
    const rows = await this.tx
      .insert(slaPolicies)
      .values(data)
      .returning();
    return rows[0]!;
  }

  @Auditable({ resourceType: 'sla_policy', action: 'update', resourceIdArg: 1 })
  async update(
    tenantId: string,
    id: string,
    patch: Partial<Omit<NewSlaPolicy, 'tenantId' | 'id'>>,
  ): Promise<SlaPolicy | null> {
    const rows = await this.tx
      .update(slaPolicies)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(slaPolicies.tenantId, tenantId), eq(slaPolicies.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  @Auditable({ resourceType: 'sla_policy', action: 'deactivate', resourceIdArg: 1 })
  async deactivate(tenantId: string, id: string, actorId: string): Promise<SlaPolicy | null> {
    const rows = await this.tx
      .update(slaPolicies)
      .set({ isActive: false, updatedAt: new Date(), updatedBy: actorId })
      .where(and(eq(slaPolicies.tenantId, tenantId), eq(slaPolicies.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  /** Append a version snapshot; not auditable itself — it IS the audit record for policy changes. */
  async snapshotVersion(data: Omit<typeof slaPolicyVersions.$inferInsert, 'id'>): Promise<void> {
    await this.tx
      .insert(slaPolicyVersions)
      .values(data);
  }
}
