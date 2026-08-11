/**
 * ReportDefinitionsRepository — data access for report_definitions.
 *
 * All writes go through the @Auditable decorator which records an immutable
 * audit entry for every create/update/delete mutation.
 *
 * Soft-delete: deletedAt is set rather than removing the row, so export job
 * history remains valid. Reads exclude soft-deleted rows by default.
 *
 * Per-tenant scoping: all reads filter by tenantId. A missing record for
 * another tenant returns null (404), not a 403, to avoid existence disclosure.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  reportDefinitions,
  type ReportDefinition,
  type NewReportDefinition,
} from '@opsninja/db';
import { TenantRepository } from '../data/tenant-repository';
import { Auditable } from '../audit/auditable.decorator';

@Injectable()
export class ReportDefinitionsRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async findById(tenantId: string, id: string): Promise<ReportDefinition | null> {
    const rows = await this.tx
      .select()
      .from(reportDefinitions)
      .where(
        and(
          eq(reportDefinitions.tenantId, tenantId),
          eq(reportDefinitions.id, id),
          isNull(reportDefinitions.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findAllForTenant(
    tenantId: string,
    options: { sharingScope?: string; createdBy?: string } = {},
  ): Promise<ReportDefinition[]> {
    const conditions = [
      eq(reportDefinitions.tenantId, tenantId),
      isNull(reportDefinitions.deletedAt),
    ];
    if (options.sharingScope) {
      conditions.push(eq(reportDefinitions.sharingScope, options.sharingScope));
    }
    if (options.createdBy) {
      conditions.push(eq(reportDefinitions.createdBy, options.createdBy));
    }
    return this.tx
      .select()
      .from(reportDefinitions)
      .where(and(...conditions))
      .orderBy(reportDefinitions.createdAt);
  }

  // --------------------------------------------------------------------------
  // Writes — all decorated with @Auditable
  // --------------------------------------------------------------------------

  @Auditable({ resourceType: 'report_definition', action: 'create' })
  async create(data: NewReportDefinition): Promise<ReportDefinition> {
    const rows = await this.tx
      .insert(reportDefinitions)
      .values(data)
      .returning();
    return rows[0]!;
  }

  @Auditable({ resourceType: 'report_definition', action: 'update', resourceIdArg: 1 })
  async update(
    tenantId: string,
    id: string,
    patch: Partial<Omit<NewReportDefinition, 'tenantId' | 'id'>>,
  ): Promise<ReportDefinition | null> {
    const rows = await this.tx
      .update(reportDefinitions)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(reportDefinitions.tenantId, tenantId),
          eq(reportDefinitions.id, id),
          isNull(reportDefinitions.deletedAt),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  @Auditable({ resourceType: 'report_definition', action: 'delete', resourceIdArg: 1 })
  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const rows = await this.tx
      .update(reportDefinitions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(reportDefinitions.tenantId, tenantId),
          eq(reportDefinitions.id, id),
          isNull(reportDefinitions.deletedAt),
        ),
      )
      .returning({ id: reportDefinitions.id });
    return rows.length > 0;
  }
}
