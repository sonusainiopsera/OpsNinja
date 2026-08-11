/**
 * ReportSchedulesRepository — data access for report_schedules and
 * report_schedule_occurrences (WO-075).
 *
 * Follows TenantRepository pattern: all queries run inside the RLS-bound
 * tenant transaction. Mutations use @Auditable for immutable audit records.
 *
 * Idempotency: insertOccurrence uses ON CONFLICT DO NOTHING on occurrence_key
 * so duplicate dispatch is impossible. Returns null on conflict (no-op path).
 */

import { Injectable } from '@nestjs/common';
import { eq, and, lte, sql, isNull } from 'drizzle-orm';
import {
  reportSchedules,
  reportScheduleOccurrences,
  type ReportSchedule,
  type NewReportSchedule,
  type ReportScheduleOccurrence,
  type NewReportScheduleOccurrence,
} from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { Auditable } from '../../audit/auditable.decorator';

@Injectable()
export class ReportSchedulesRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // report_schedules reads
  // --------------------------------------------------------------------------

  async findById(tenantId: string, id: string): Promise<ReportSchedule | null> {
    const rows = await this.tx
      .select()
      .from(reportSchedules)
      .where(and(eq(reportSchedules.tenantId, tenantId), eq(reportSchedules.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByDefinitionId(tenantId: string, reportDefinitionId: string): Promise<ReportSchedule | null> {
    const rows = await this.tx
      .select()
      .from(reportSchedules)
      .where(
        and(
          eq(reportSchedules.tenantId, tenantId),
          eq(reportSchedules.reportDefinitionId, reportDefinitionId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findAllForTenant(tenantId: string): Promise<ReportSchedule[]> {
    return this.tx
      .select()
      .from(reportSchedules)
      .where(eq(reportSchedules.tenantId, tenantId))
      .orderBy(reportSchedules.createdAt);
  }

  // --------------------------------------------------------------------------
  // report_schedules writes
  // --------------------------------------------------------------------------

  @Auditable({ resourceType: 'report_schedule', action: 'create' })
  async create(data: NewReportSchedule): Promise<ReportSchedule> {
    const rows = await this.tx
      .insert(reportSchedules)
      .values(data)
      .returning();
    return rows[0]!;
  }

  @Auditable({ resourceType: 'report_schedule', action: 'update', resourceIdArg: 1 })
  async update(
    tenantId: string,
    id: string,
    patch: Partial<Omit<NewReportSchedule, 'tenantId' | 'id' | 'createdAt'>>,
  ): Promise<ReportSchedule | null> {
    const rows = await this.tx
      .update(reportSchedules)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(reportSchedules.tenantId, tenantId), eq(reportSchedules.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  @Auditable({ resourceType: 'report_schedule', action: 'delete', resourceIdArg: 1 })
  async delete(tenantId: string, id: string): Promise<boolean> {
    const rows = await this.tx
      .delete(reportSchedules)
      .where(and(eq(reportSchedules.tenantId, tenantId), eq(reportSchedules.id, id)))
      .returning({ id: reportSchedules.id });
    return rows.length > 0;
  }

  // --------------------------------------------------------------------------
  // Scheduler worker: claim due schedules with FOR UPDATE SKIP LOCKED
  // --------------------------------------------------------------------------

  /**
   * Claim up to `limit` enabled schedules whose next_fire_at <= now.
   * Uses FOR UPDATE SKIP LOCKED so concurrent scheduler pods claim disjoint sets.
   * Returns a raw SQL result (drizzle execute) to allow the FOR UPDATE hint.
   */
  async claimDueSchedules(limit: number): Promise<ReportSchedule[]> {
    // Drizzle doesn't have built-in FOR UPDATE SKIP LOCKED; use raw execute.
    const result = await this.tx.execute(
      sql`
        SELECT *
        FROM report_schedules
        WHERE enabled = true
          AND next_fire_at <= now()
        ORDER BY next_fire_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `,
    );
    return (result.rows ?? []) as unknown as ReportSchedule[];
  }

  /** Update next_fire_at and last_fired_at after a tick. */
  async advanceSchedule(
    id: string,
    nextFireAt: Date | null,
    lastFiredAt: Date,
  ): Promise<void> {
    await this.tx
      .update(reportSchedules)
      .set({ nextFireAt, lastFiredAt, updatedAt: new Date() })
      .where(eq(reportSchedules.id, id));
  }

  /** Disable a schedule (e.g. definition deleted, owner lost role). */
  async disable(id: string): Promise<void> {
    await this.tx
      .update(reportSchedules)
      .set({ enabled: false, nextFireAt: null, updatedAt: new Date() })
      .where(eq(reportSchedules.id, id));
  }

  // --------------------------------------------------------------------------
  // report_schedule_occurrences
  // --------------------------------------------------------------------------

  /**
   * Insert an occurrence row. Returns the row on success, null if the
   * occurrence_key already exists (ON CONFLICT DO NOTHING = idempotent no-op).
   */
  async insertOccurrence(data: NewReportScheduleOccurrence): Promise<ReportScheduleOccurrence | null> {
    const rows = await this.tx
      .insert(reportScheduleOccurrences)
      .values(data)
      .onConflictDoNothing()
      .returning();
    return rows[0] ?? null;
  }

  async findOccurrenceById(tenantId: string, id: string): Promise<ReportScheduleOccurrence | null> {
    const rows = await this.tx
      .select()
      .from(reportScheduleOccurrences)
      .where(
        and(
          eq(reportScheduleOccurrences.tenantId, tenantId),
          eq(reportScheduleOccurrences.id, id),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async updateOccurrence(
    id: string,
    patch: Partial<Pick<ReportScheduleOccurrence, 'status' | 'exportJobId' | 'attempts' | 'errorCode'>>,
  ): Promise<void> {
    await this.tx
      .update(reportScheduleOccurrences)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(reportScheduleOccurrences.id, id));
  }
}
