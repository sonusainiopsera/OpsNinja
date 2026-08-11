import { Injectable } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { organizations } from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';

@Injectable()
export class OrganizationsRepository extends TenantRepository {
  /**
   * Returns organizations matching the given IDs within the current tenant.
   * Used to validate that referenced org IDs belong to the caller's tenant.
   */
  async findByIds(tenantId: string, ids: string[]): Promise<Array<{ id: string; name: string }>> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(
        and(
          eq(organizations.tenantId, tenantId),
          inArray(organizations.id, ids),
        ),
      );
    return rows;
  }

  /** Returns a single organization within the tenant, or null. */
  async findById(tenantId: string, id: string): Promise<{ id: string; name: string } | null> {
    const rows = await this.db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(
        and(
          eq(organizations.tenantId, tenantId),
          eq(organizations.id, id),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
