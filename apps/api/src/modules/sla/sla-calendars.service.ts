import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SlaCalendarsRepository } from './sla-calendars.repository';
import { AuditWriter } from '../../common/audit/audit-writer';
import { RequestContextStore } from '../../observability/request-context';
import { assertFound } from '../../common/errors/not-found';
import type {
  CreateCalendarDto,
  UpdateCalendarDto,
  CalendarResponse,
  PagedResponse,
  ListQueryDto,
} from './dto/sla.dto';
import type { SlaCalendar } from '@opsninja/db';

@Injectable()
export class SlaCalendarsService {
  constructor(
    private readonly repo: SlaCalendarsRepository,
    private readonly auditWriter: AuditWriter,
  ) {}

  async listCalendars(query: ListQueryDto): Promise<PagedResponse<CalendarResponse>> {
    const { tenantId } = RequestContextStore.getPrincipal();
    const rows = await this.repo.findAll(tenantId, query.cursor, query.limit);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;

    const data = await Promise.all(page.map((c) => this.hydrate(c)));
    return { data, next_cursor: nextCursor };
  }

  async getCalendar(id: string): Promise<CalendarResponse> {
    const cal = await this.repo.findById(id);
    assertFound(cal, 'SlaCalendar');
    return this.hydrate(cal);
  }

  async createCalendar(dto: CreateCalendarDto): Promise<CalendarResponse> {
    const { userId, tenantId } = RequestContextStore.getPrincipal();

    const existing = await this.repo.findByName(dto.name);
    if (existing) {
      throw new ConflictException({ code: 'SLA_CALENDAR_NAME_CONFLICT', message: `Calendar "${dto.name}" already exists.` });
    }

    const cal = await this.repo.create({
      tenantId,
      name: dto.name,
      calendarType: dto.calendar_type,
      timezone: dto.timezone,
      isActive: true,
      createdBy: userId,
      updatedBy: userId,
    });

    // Replace windows and holidays
    if (dto.windows.length > 0) {
      await this.repo.createWindows(
        dto.windows.map((w) => ({
          tenantId,
          calendarId: cal.id,
          weekday: w.weekday,
          startLocalTime: w.start_local_time,
          endLocalTime: w.end_local_time,
        })),
      );
    }

    if (dto.holidays.length > 0) {
      await this.repo.createHolidays(
        dto.holidays.map((h) => ({
          tenantId,
          calendarId: cal.id,
          holidayDate: h.holiday_date,
          label: h.label,
        })),
      );
    }

    await this.auditWriter.append({
      action: 'sla_calendar.created',
      resourceType: 'sla_calendar',
      resourceId: cal.id,
      afterState: { id: cal.id, name: cal.name, calendar_type: cal.calendarType },
      forceEmit: true,
    });

    return this.hydrate(cal);
  }

  async updateCalendar(id: string, dto: UpdateCalendarDto): Promise<CalendarResponse> {
    const { userId, tenantId } = RequestContextStore.getPrincipal();

    const cal = await this.repo.findById(id);
    assertFound(cal, 'SlaCalendar');

    if (!cal.isActive) {
      throw new UnprocessableEntityException({ code: 'SLA_CALENDAR_INACTIVE', message: 'Cannot update an inactive calendar.' });
    }

    if (dto.name && dto.name !== cal.name) {
      const conflict = await this.repo.findByName(dto.name);
      if (conflict) {
        throw new ConflictException({ code: 'SLA_CALENDAR_NAME_CONFLICT', message: `Calendar "${dto.name}" already exists.` });
      }
    }

    const newType = dto.calendar_type ?? cal.calendarType;
    if (dto.windows !== undefined) {
      if (newType === 'business_hours' && dto.windows.length === 0) {
        throw new UnprocessableEntityException({
          code: 'SLA_CALENDAR_NO_WINDOWS',
          message: 'business_hours calendar must have at least one window.',
        });
      }
      await this.repo.deleteWindowsByCalendarId(id);
      if (dto.windows.length > 0) {
        await this.repo.createWindows(
          dto.windows.map((w) => ({
            tenantId,
            calendarId: id,
            weekday: w.weekday,
            startLocalTime: w.start_local_time,
            endLocalTime: w.end_local_time,
          })),
        );
      }
    }

    if (dto.holidays !== undefined) {
      await this.repo.deleteHolidaysByCalendarId(id);
      if (dto.holidays.length > 0) {
        await this.repo.createHolidays(
          dto.holidays.map((h) => ({
            tenantId,
            calendarId: id,
            holidayDate: h.holiday_date,
            label: h.label,
          })),
        );
      }
    }

    const updated = await this.repo.update(id, {
      name: dto.name,
      calendarType: dto.calendar_type,
      timezone: dto.timezone,
      updatedBy: userId,
    });
    assertFound(updated, 'SlaCalendar');

    await this.auditWriter.append({
      action: 'sla_calendar.updated',
      resourceType: 'sla_calendar',
      resourceId: id,
      beforeState: { name: cal.name, calendar_type: cal.calendarType, timezone: cal.timezone },
      afterState: { name: updated.name, calendar_type: updated.calendarType, timezone: updated.timezone },
      forceEmit: true,
    });

    return this.hydrate(updated);
  }

  async deleteCalendar(id: string): Promise<void> {
    const { userId } = RequestContextStore.getPrincipal();
    const cal = await this.repo.findById(id);
    assertFound(cal, 'SlaCalendar');

    if (!cal.isActive) {
      throw new ConflictException({ code: 'SLA_CALENDAR_ALREADY_INACTIVE', message: 'Calendar is already inactive.' });
    }

    await this.repo.softDelete(id, userId);

    await this.auditWriter.append({
      action: 'sla_calendar.deleted',
      resourceType: 'sla_calendar',
      resourceId: id,
      forceEmit: true,
    });
  }

  private async hydrate(cal: SlaCalendar): Promise<CalendarResponse> {
    const [windows, holidays] = await Promise.all([
      this.repo.findWindowsByCalendarId(cal.id),
      this.repo.findHolidaysByCalendarId(cal.id),
    ]);

    return {
      id: cal.id,
      name: cal.name,
      calendar_type: cal.calendarType,
      timezone: cal.timezone,
      is_active: cal.isActive,
      windows: windows.map((w) => ({
        id: w.id,
        weekday: w.weekday,
        start_local_time: w.startLocalTime,
        end_local_time: w.endLocalTime,
      })),
      holidays: holidays.map((h) => ({
        id: h.id,
        holiday_date: h.holidayDate,
        label: h.label,
      })),
      updated_at: cal.updatedAt.toISOString(),
    };
  }
}
