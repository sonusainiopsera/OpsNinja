/**
 * SlaCalendarsRepository — data access for sla_calendars, windows, and holidays.
 *
 * Extends TenantRepository so every query runs inside the RLS-bound tenant
 * transaction. All write methods are decorated with @Auditable.
 */

import { Injectable } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import {
  slaCalendars,
  slaCalendarWindows,
  slaCalendarHolidays,
  type SlaCalendar,
  type NewSlaCalendar,
  type SlaCalendarWindow,
  type NewSlaCalendarWindow,
  type SlaCalendarHoliday,
  type NewSlaCalendarHoliday,
} from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';
import { Auditable } from '../audit/auditable.decorator';

@Injectable()
export class SlaCalendarsRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Calendar reads
  // --------------------------------------------------------------------------

  async findById(tenantId: string, id: string): Promise<SlaCalendar | null> {
    const rows = await this.tx
      .select()
      .from(slaCalendars)
      .where(and(eq(slaCalendars.tenantId, tenantId), eq(slaCalendars.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findPaginated(
    tenantId: string,
    limit: number,
    cursor?: string,
  ): Promise<SlaCalendar[]> {
    const conditions = [eq(slaCalendars.tenantId, tenantId)];
    if (cursor) {
      conditions.push(sql`${slaCalendars.id} > ${cursor}`);
    }
    return this.tx
      .select()
      .from(slaCalendars)
      .where(and(...conditions))
      .orderBy(slaCalendars.id)
      .limit(limit);
  }

  async findWindowsByCalendarId(tenantId: string, calendarId: string): Promise<SlaCalendarWindow[]> {
    return this.tx
      .select()
      .from(slaCalendarWindows)
      .where(
        and(
          eq(slaCalendarWindows.tenantId, tenantId),
          eq(slaCalendarWindows.calendarId, calendarId),
        ),
      )
      .orderBy(slaCalendarWindows.weekday, slaCalendarWindows.startLocalTime);
  }

  async findHolidaysByCalendarId(tenantId: string, calendarId: string): Promise<SlaCalendarHoliday[]> {
    return this.tx
      .select()
      .from(slaCalendarHolidays)
      .where(
        and(
          eq(slaCalendarHolidays.tenantId, tenantId),
          eq(slaCalendarHolidays.calendarId, calendarId),
        ),
      )
      .orderBy(slaCalendarHolidays.holidayDate);
  }

  // --------------------------------------------------------------------------
  // Calendar writes
  // --------------------------------------------------------------------------

  @Auditable({ resourceType: 'sla_calendar', action: 'create' })
  async create(data: NewSlaCalendar): Promise<SlaCalendar> {
    const rows = await this.tx
      .insert(slaCalendars)
      .values(data)
      .returning();
    return rows[0]!;
  }

  @Auditable({ resourceType: 'sla_calendar', action: 'update', resourceIdArg: 1 })
  async update(
    tenantId: string,
    id: string,
    patch: Partial<Omit<NewSlaCalendar, 'tenantId' | 'id'>>,
  ): Promise<SlaCalendar | null> {
    const rows = await this.tx
      .update(slaCalendars)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(slaCalendars.tenantId, tenantId), eq(slaCalendars.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  @Auditable({ resourceType: 'sla_calendar', action: 'deactivate', resourceIdArg: 1 })
  async deactivate(tenantId: string, id: string): Promise<SlaCalendar | null> {
    const rows = await this.tx
      .update(slaCalendars)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(slaCalendars.tenantId, tenantId), eq(slaCalendars.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // Window writes (bulk replace pattern: delete + insert per update)
  // --------------------------------------------------------------------------

  async replaceWindows(
    tenantId: string,
    calendarId: string,
    windows: Omit<NewSlaCalendarWindow, 'id' | 'tenantId' | 'calendarId'>[],
  ): Promise<void> {
    await this.tx
      .delete(slaCalendarWindows)
      .where(
        and(
          eq(slaCalendarWindows.tenantId, tenantId),
          eq(slaCalendarWindows.calendarId, calendarId),
        ),
      );
    if (windows.length > 0) {
      await this.tx
        .insert(slaCalendarWindows)
        .values(
          windows.map((w) => ({ ...w, tenantId, calendarId })),
        );
    }
  }

  async replaceHolidays(
    tenantId: string,
    calendarId: string,
    holidays: Omit<NewSlaCalendarHoliday, 'id' | 'tenantId' | 'calendarId'>[],
  ): Promise<void> {
    await this.tx
      .delete(slaCalendarHolidays)
      .where(
        and(
          eq(slaCalendarHolidays.tenantId, tenantId),
          eq(slaCalendarHolidays.calendarId, calendarId),
        ),
      );
    if (holidays.length > 0) {
      await this.tx
        .insert(slaCalendarHolidays)
        .values(
          holidays.map((h) => ({ ...h, tenantId, calendarId })),
        );
    }
  }
}
