import { Injectable } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { slaPolicies, slaPolicyVersions } from '@opsninja/db';
import type { SlaPolicy, NewSlaPolicy, SlaPolicyVersion, NewSlaPolicyVersion } from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';

@Injectable()
export class SlaPoliciesRepository extends TenantRepository {

  async findAll(cursor?: string, limit = 50): Promise<SlaPolicy[]> {
    const rows = await this.db
      .select()
      .from(slaPolicies)
      .where(
        cursor
          ? and(eq(slaPolicies.isActive, true), sql`${slaPolicies.id} > ${cursor}::uuid`)
          : eq(slaPolicies.isActive, true),
      )
      .orderBy(slaPolicies.id)
      .limit(limit + 1);
    return rows;
  }

  async findById(id: string): Promise<SlaPolicy | undefined> {
    const rows = await this.db
      .select()
      .from(slaPolicies)
      .where(eq(slaPolicies.id, id));
    return rows[0];
  }

  async findActiveByScopeAndPriority(
    scopeType: string,
    scopeId: string | null,
    priority: string,
  ): Promise<SlaPolicy | undefined> {
    const scopeCondition = scopeId
      ? and(
          eq(slaPolicies.scopeType, scopeType as 'tenant' | 'organization' | 'ticket_type'),
          eq(slaPolicies.scopeId, scopeId),
          eq(slaPolicies.priority, priority as 'P1' | 'P2' | 'P3' | 'P4'),
          eq(slaPolicies.isActive, true),
        )
      : and(
          eq(slaPolicies.scopeType, scopeType as 'tenant' | 'organization' | 'ticket_type'),
          sql`${slaPolicies.scopeId} IS NULL`,
          eq(slaPolicies.priority, priority as 'P1' | 'P2' | 'P3' | 'P4'),
          eq(slaPolicies.isActive, true),
        );
    const rows = await this.db
      .select()
      .from(slaPolicies)
      .where(scopeCondition);
    return rows[0];
  }

  async create(data: NewSlaPolicy): Promise<SlaPolicy> {
    const rows = await this.db
      .insert(slaPolicies)
      .values(data)
      .returning();
    return rows[0]!;
  }

  async update(
    id: string,
    patch: Partial<Pick<SlaPolicy,
      'scopeType' | 'scopeId' | 'priority' | 'responseTargetMins' | 'resolutionTargetMins' |
      'calendarId' | 'reminderPctFirst' | 'reminderPctSecond' | 'version' | 'updatedBy' | 'updatedAt'
    >>,
  ): Promise<SlaPolicy | undefined> {
    const rows = await this.db
      .update(slaPolicies)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(slaPolicies.id, id))
      .returning();
    return rows[0];
  }

  async deactivate(id: string, updatedBy: string): Promise<SlaPolicy | undefined> {
    const rows = await this.db
      .update(slaPolicies)
      .set({ isActive: false, updatedAt: new Date(), updatedBy })
      .where(and(eq(slaPolicies.id, id), eq(slaPolicies.isActive, true)))
      .returning();
    return rows[0];
  }

  // ── Version snapshots ─────────────────────────────────────────────────────

  async createVersion(data: NewSlaPolicyVersion): Promise<SlaPolicyVersion> {
    const rows = await this.db
      .insert(slaPolicyVersions)
      .values(data)
      .returning();
    return rows[0]!;
  }

  async findVersionsByPolicyId(policyId: string): Promise<SlaPolicyVersion[]> {
    return this.db
      .select()
      .from(slaPolicyVersions)
      .where(eq(slaPolicyVersions.policyId, policyId))
      .orderBy(slaPolicyVersions.version);
  }
}
