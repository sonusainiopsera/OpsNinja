import { Injectable } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import {
  slaCalendars,
  slaCalendarWindows,
  slaCalendarHolidays,
} from '@opsninja/db';
import type {
  SlaCalendar,
  NewSlaCalendar,
  SlaCalendarWindow,
  NewSlaCalendarWindow,
  SlaCalendarHoliday,
  NewSlaCalendarHoliday,
} from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';

@Injectable()
export class SlaCalendarsRepository extends TenantRepository {

  async findAll(tenantId: string, cursor?: string, limit = 50): Promise<SlaCalendar[]> {
    const rows = await this.db
      .select()
      .from(slaCalendars)
      .where(
        cursor
          ? and(eq(slaCalendars.isActive, true), sql`${slaCalendars.id} > ${cursor}::uuid`)
          : eq(slaCalendars.isActive, true),
      )
      .orderBy(slaCalendars.id)
      .limit(limit + 1);
    return rows;
  }

  async findById(id: string): Promise<SlaCalendar | undefined> {
    const rows = await this.db
      .select()
      .from(slaCalendars)
      .where(eq(slaCalendars.id, id));
    return rows[0];
  }

  async findByName(name: string): Promise<SlaCalendar | undefined> {
    const rows = await this.db
      .select()
      .from(slaCalendars)
      .where(and(eq(slaCalendars.name, name), eq(slaCalendars.isActive, true)));
    return rows[0];
  }

  async create(data: NewSlaCalendar): Promise<SlaCalendar> {
    const rows = await this.db
      .insert(slaCalendars)
      .values(data)
      .returning();
    return rows[0]!;
  }

  async update(id: string, patch: Partial<Pick<SlaCalendar, 'name' | 'calendarType' | 'timezone' | 'updatedBy' | 'updatedAt'>>): Promise<SlaCalendar | undefined> {
    const rows = await this.db
      .update(slaCalendars)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(slaCalendars.id, id))
      .returning();
    return rows[0];
  }

  async softDelete(id: string, updatedBy: string): Promise<void> {
    await this.db
      .update(slaCalendars)
      .set({ isActive: false, updatedAt: new Date(), updatedBy })
      .where(eq(slaCalendars.id, id));
  }

  // ── Windows ──────────────────────────────────────────────────────────────

  async findWindowsByCalendarId(calendarId: string): Promise<SlaCalendarWindow[]> {
    return this.db
      .select()
      .from(slaCalendarWindows)
      .where(eq(slaCalendarWindows.calendarId, calendarId))
      .orderBy(slaCalendarWindows.weekday);
  }

  async deleteWindowsByCalendarId(calendarId: string): Promise<void> {
    await this.db
      .delete(slaCalendarWindows)
      .where(eq(slaCalendarWindows.calendarId, calendarId));
  }

  async createWindows(windows: NewSlaCalendarWindow[]): Promise<SlaCalendarWindow[]> {
    if (windows.length === 0) return [];
    return this.db
      .insert(slaCalendarWindows)
      .values(windows)
      .returning();
  }

  // ── Holidays ──────────────────────────────────────────────────────────────

  async findHolidaysByCalendarId(calendarId: string): Promise<SlaCalendarHoliday[]> {
    return this.db
      .select()
      .from(slaCalendarHolidays)
      .where(eq(slaCalendarHolidays.calendarId, calendarId))
      .orderBy(slaCalendarHolidays.holidayDate);
  }

  async deleteHolidaysByCalendarId(calendarId: string): Promise<void> {
    await this.db
      .delete(slaCalendarHolidays)
      .where(eq(slaCalendarHolidays.calendarId, calendarId));
  }

  async createHolidays(holidays: NewSlaCalendarHoliday[]): Promise<SlaCalendarHoliday[]> {
    if (holidays.length === 0) return [];
    return this.db
      .insert(slaCalendarHolidays)
      .values(holidays)
      .returning();
  }
}
