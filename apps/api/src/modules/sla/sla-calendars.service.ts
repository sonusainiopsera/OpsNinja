/**
 * SlaCalendarsService — business logic for SLA calendar CRUD.
 *
 * Calendar windows and holidays are managed as full replacements on update
 * (delete-all + re-insert) to keep the logic simple and avoid partial-update
 * anomalies. Audit writes are injected via AuditWriter.
 */

import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { SlaCalendar, SlaCalendarWindow, SlaCalendarHoliday } from '@opsninja/db';
import { SlaCalendarsRepository } from './sla-calendars.repository';
import { AuditWriter } from '../audit/audit-writer';
import type {
  CreateCalendarDto,
  UpdateCalendarDto,
  SlaCalendarResponse,
  SlaCalendarWindowResponse,
  SlaCalendarHolidayResponse,
  PaginatedResponse,
} from './dto/sla-policy.dto';

@Injectable()
export class SlaCalendarsService {
  constructor(
    private readonly repo: SlaCalendarsRepository,
    private readonly auditWriter: AuditWriter,
  ) {}

  // --------------------------------------------------------------------------
  // List
  // --------------------------------------------------------------------------

  async list(
    tenantId: string,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedResponse<SlaCalendarResponse>> {
    const fetchLimit = Math.min(limit, 100);
    const rows = await this.repo.findPaginated(tenantId, fetchLimit + 1, cursor);
    const hasMore = rows.length > fetchLimit;
    const data = hasMore ? rows.slice(0, fetchLimit) : rows;
    const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

    // Load windows + holidays for each calendar.
    const responses = await Promise.all(
      data.map(async (cal) => {
        const [windows, holidays] = await Promise.all([
          this.repo.findWindowsByCalendarId(tenantId, cal.id),
          this.repo.findHolidaysByCalendarId(tenantId, cal.id),
        ]);
        return toResponse(cal, windows, holidays);
      }),
    );
    return { data: responses, nextCursor };
  }

  // --------------------------------------------------------------------------
  // Get
  // --------------------------------------------------------------------------

  async getById(tenantId: string, id: string): Promise<SlaCalendarResponse> {
    const cal = await this.requireCalendar(tenantId, id);
    const [windows, holidays] = await Promise.all([
      this.repo.findWindowsByCalendarId(tenantId, id),
      this.repo.findHolidaysByCalendarId(tenantId, id),
    ]);
    return toResponse(cal, windows, holidays);
  }

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  async create(
    tenantId: string,
    dto: CreateCalendarDto,
    _actorId: string,
  ): Promise<SlaCalendarResponse> {
    const cal = await this.repo.create({
      id: randomUUID(),
      tenantId,
      name: dto.name,
      calendarType: dto.calendarType,
      timezone: dto.timezone,
      isActive: true,
    });

    if (dto.windows.length > 0 || dto.holidays.length > 0) {
      await this.repo.replaceWindows(tenantId, cal.id, dto.windows);
      await this.repo.replaceHolidays(tenantId, cal.id, dto.holidays);
    }

    const [windows, holidays] = await Promise.all([
      this.repo.findWindowsByCalendarId(tenantId, cal.id),
      this.repo.findHolidaysByCalendarId(tenantId, cal.id),
    ]);
    return toResponse(cal, windows, holidays);
  }

  // --------------------------------------------------------------------------
  // Update
  // --------------------------------------------------------------------------

  async update(
    tenantId: string,
    id: string,
    dto: UpdateCalendarDto,
    _actorId: string,
  ): Promise<SlaCalendarResponse> {
    await this.requireCalendar(tenantId, id);

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch['name'] = dto.name;
    if (dto.calendarType !== undefined) patch['calendarType'] = dto.calendarType;
    if (dto.timezone !== undefined) patch['timezone'] = dto.timezone;

    const updated = await this.repo.update(tenantId, id, patch as Parameters<typeof this.repo.update>[2]);
    if (!updated) throw new NotFoundException({ error: { code: 'SLA_CALENDAR_NOT_FOUND', message: 'Calendar not found.' } });

    if (dto.windows !== undefined) {
      await this.repo.replaceWindows(tenantId, id, dto.windows);
    }
    if (dto.holidays !== undefined) {
      await this.repo.replaceHolidays(tenantId, id, dto.holidays);
    }

    const [windows, holidays] = await Promise.all([
      this.repo.findWindowsByCalendarId(tenantId, id),
      this.repo.findHolidaysByCalendarId(tenantId, id),
    ]);
    return toResponse(updated, windows, holidays);
  }

  // --------------------------------------------------------------------------
  // Deactivate
  // --------------------------------------------------------------------------

  async deactivate(tenantId: string, id: string): Promise<SlaCalendarResponse> {
    await this.requireCalendar(tenantId, id);
    const updated = await this.repo.deactivate(tenantId, id);
    if (!updated) throw new NotFoundException({ error: { code: 'SLA_CALENDAR_NOT_FOUND', message: 'Calendar not found.' } });

    const [windows, holidays] = await Promise.all([
      this.repo.findWindowsByCalendarId(tenantId, id),
      this.repo.findHolidaysByCalendarId(tenantId, id),
    ]);
    return toResponse(updated, windows, holidays);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async requireCalendar(tenantId: string, id: string): Promise<SlaCalendar> {
    const cal = await this.repo.findById(tenantId, id);
    if (!cal) {
      throw new NotFoundException({ error: { code: 'SLA_CALENDAR_NOT_FOUND', message: 'Calendar not found.' } });
    }
    return cal;
  }
}

// ---------------------------------------------------------------------------
// Response mappers
// ---------------------------------------------------------------------------

function windowToResponse(w: SlaCalendarWindow): SlaCalendarWindowResponse {
  return {
    id: w.id,
    weekday: w.weekday,
    startLocalTime: w.startLocalTime,
    endLocalTime: w.endLocalTime,
  };
}

function holidayToResponse(h: SlaCalendarHoliday): SlaCalendarHolidayResponse {
  return {
    id: h.id,
    holidayDate: h.holidayDate,
    label: h.label,
  };
}

function toResponse(
  cal: SlaCalendar,
  windows: SlaCalendarWindow[],
  holidays: SlaCalendarHoliday[],
): SlaCalendarResponse {
  return {
    id: cal.id,
    name: cal.name,
    calendarType: cal.calendarType,
    timezone: cal.timezone,
    isActive: cal.isActive,
    windows: windows.map(windowToResponse),
    holidays: holidays.map(holidayToResponse),
    createdAt: cal.createdAt.toISOString(),
    updatedAt: cal.updatedAt.toISOString(),
  };
}
