/**
 * ReportSchedulesService — business logic for schedule CRUD (WO-075).
 *
 * Responsibilities:
 *   - Resolve cron expression from cadence + override
 *   - Enforce minimum 1-hour interval (rejects with 422 SCHEDULE_INTERVAL_TOO_SHORT)
 *   - Validate recipients via RecipientPolicy (defaults to deny)
 *   - Compute first next_fire_at using IANA-aware cron calculator
 *   - Write audit records on every mutation
 *   - Auto-disable on definition deletion / owner deactivation
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { outboxEvents } from '@opsninja/db';
import { ReportDefinitionsRepository } from '../report-definitions.repository';
import { ReportSchedulesRepository } from './report-schedules.repository';
import { AuditWriter } from '../../audit/audit-writer';
import { RecipientPolicy } from '../domain/recipient-policy';
import {
  computeNextFireAt,
  validateMinimumInterval,
  parseCronExpression,
  buildOccurrenceKey,
  CronParseError,
} from '../domain/cron-next-fire';
import { resolveCronExpression, type ScheduleResponse } from '../api/dto/report-schedule.dto';
import type { ReportSchedule } from '@opsninja/db';
import type { CreateScheduleDto, UpdateScheduleDto } from '../api/dto/report-schedule.dto';

interface SchedulePrincipal {
  tenantId: string;
  userId: string;
}

function toResponse(s: ReportSchedule): ScheduleResponse {
  return {
    id: s.id,
    reportDefinitionId: s.reportDefinitionId,
    cadence: s.cadence,
    cronExpression: s.cronExpression,
    timezone: s.timezone,
    format: s.format,
    recipients: s.recipients as unknown[],
    enabled: s.enabled,
    nextFireAt: s.nextFireAt ? s.nextFireAt.toISOString() : null,
    lastFiredAt: s.lastFiredAt ? s.lastFiredAt.toISOString() : null,
    createdBy: s.createdBy ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

@Injectable()
export class ReportSchedulesService {
  private readonly logger = new Logger(ReportSchedulesService.name);

  constructor(
    private readonly schedulesRepo: ReportSchedulesRepository,
    private readonly definitionsRepo: ReportDefinitionsRepository,
    private readonly recipientPolicy: RecipientPolicy,
    private readonly auditWriter: AuditWriter,
  ) {}

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  async create(
    reportDefinitionId: string,
    dto: CreateScheduleDto,
    principal: SchedulePrincipal,
  ): Promise<ScheduleResponse> {
    const { tenantId, userId } = principal;

    // Validate definition exists.
    const definition = await this.definitionsRepo.findById(tenantId, reportDefinitionId);
    if (!definition) {
      throw new NotFoundException({
        error: { code: 'SCHEDULE_DEFINITION_MISSING', message: 'Report definition not found.' },
      });
    }

    // Resolve cron expression.
    const cronExpression = resolveCronExpression(dto.cadence, dto.cronExpression);

    // Parse and validate interval (≥ 1 hour).
    this.assertValidCron(cronExpression, dto.timezone);

    // Validate recipients.
    await this.recipientPolicy.validateRecipients(tenantId, dto.recipients as any);

    // Compute first next_fire_at.
    const { nextUtc } = computeNextFireAt({
      expression: cronExpression,
      timezone: dto.timezone,
      after: new Date(),
    });

    const schedule = await this.schedulesRepo.create({
      id: randomUUID(),
      tenantId,
      reportDefinitionId,
      cadence: dto.cadence,
      cronExpression,
      timezone: dto.timezone,
      format: dto.format,
      recipients: dto.recipients as unknown as object[],
      enabled: dto.enabled,
      nextFireAt: dto.enabled ? nextUtc : null,
      createdBy: userId,
    });

    await this.auditWriter.append({
      resourceType: 'report_schedule',
      resourceId: schedule.id,
      action: 'create',
      beforeState: null,
      afterState: {
        reportDefinitionId,
        cadence: dto.cadence,
        cronExpression,
        timezone: dto.timezone,
        format: dto.format,
        recipientCount: dto.recipients.length,
        enabled: dto.enabled,
      },
      metadata: { tenantId, actorId: userId },
    });

    this.logger.log('Report schedule created', {
      tenantId,
      scheduleId: schedule.id,
      reportDefinitionId,
      cadence: dto.cadence,
    });

    return toResponse(schedule);
  }

  // --------------------------------------------------------------------------
  // Get
  // --------------------------------------------------------------------------

  async getByDefinitionId(
    reportDefinitionId: string,
    tenantId: string,
  ): Promise<ScheduleResponse | null> {
    const schedule = await this.schedulesRepo.findByDefinitionId(tenantId, reportDefinitionId);
    return schedule ? toResponse(schedule) : null;
  }

  async getById(id: string, tenantId: string): Promise<ScheduleResponse> {
    const schedule = await this.schedulesRepo.findById(tenantId, id);
    if (!schedule) {
      throw new NotFoundException({
        error: { code: 'SCHEDULE_NOT_FOUND', message: 'Report schedule not found.' },
      });
    }
    return toResponse(schedule);
  }

  // --------------------------------------------------------------------------
  // Update (patch)
  // --------------------------------------------------------------------------

  async update(
    reportDefinitionId: string,
    dto: UpdateScheduleDto,
    principal: SchedulePrincipal,
  ): Promise<ScheduleResponse> {
    const { tenantId, userId } = principal;

    const existing = await this.schedulesRepo.findByDefinitionId(tenantId, reportDefinitionId);
    if (!existing) {
      throw new NotFoundException({
        error: { code: 'SCHEDULE_NOT_FOUND', message: 'Report schedule not found.' },
      });
    }

    const cadence = dto.cadence ?? existing.cadence;
    const rawCron = dto.cronExpression ?? (cadence !== existing.cadence ? undefined : existing.cronExpression);
    const cronExpression = resolveCronExpression(cadence, rawCron);
    const timezone = dto.timezone ?? existing.timezone;
    const enabled = dto.enabled ?? existing.enabled;

    this.assertValidCron(cronExpression, timezone);

    if (dto.recipients) {
      await this.recipientPolicy.validateRecipients(tenantId, dto.recipients as any);
    }

    // Recompute next_fire_at if expression or timezone changed.
    let nextFireAt = existing.nextFireAt;
    const expressionChanged =
      cronExpression !== existing.cronExpression || timezone !== existing.timezone;
    if (expressionChanged || (enabled && !existing.enabled)) {
      const { nextUtc } = computeNextFireAt({
        expression: cronExpression,
        timezone,
        after: new Date(),
      });
      nextFireAt = nextUtc;
    }
    if (!enabled) nextFireAt = null;

    const updated = await this.schedulesRepo.update(tenantId, existing.id, {
      cadence,
      cronExpression,
      timezone,
      format: dto.format ?? existing.format,
      recipients: dto.recipients ? (dto.recipients as unknown as object[]) : (existing.recipients as object[]),
      enabled,
      nextFireAt,
    });

    if (!updated) {
      throw new NotFoundException({
        error: { code: 'SCHEDULE_NOT_FOUND', message: 'Report schedule not found.' },
      });
    }

    await this.auditWriter.append({
      resourceType: 'report_schedule',
      resourceId: existing.id,
      action: 'update',
      beforeState: { cadence: existing.cadence, enabled: existing.enabled },
      afterState: { cadence, cronExpression, timezone, enabled },
      metadata: { tenantId, actorId: userId },
    });

    return toResponse(updated);
  }

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  async delete(
    reportDefinitionId: string,
    principal: SchedulePrincipal,
  ): Promise<void> {
    const { tenantId, userId } = principal;

    const existing = await this.schedulesRepo.findByDefinitionId(tenantId, reportDefinitionId);
    if (!existing) {
      throw new NotFoundException({
        error: { code: 'SCHEDULE_NOT_FOUND', message: 'Report schedule not found.' },
      });
    }

    await this.schedulesRepo.delete(tenantId, existing.id);

    await this.auditWriter.append({
      resourceType: 'report_schedule',
      resourceId: existing.id,
      action: 'delete',
      beforeState: { cadence: existing.cadence, enabled: existing.enabled },
      afterState: null,
      metadata: { tenantId, actorId: userId },
    });

    this.logger.log('Report schedule deleted', { tenantId, scheduleId: existing.id, reportDefinitionId });
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private assertValidCron(cronExpression: string, timezone: string): void {
    try {
      parseCronExpression(cronExpression);
      validateMinimumInterval(cronExpression, timezone);
    } catch (err) {
      if (err instanceof CronParseError) {
        const isSubHourly = err.message.includes('minimum interval');
        throw new UnprocessableEntityException({
          error: {
            code: isSubHourly ? 'SCHEDULE_INTERVAL_TOO_SHORT' : 'SCHEDULE_CRON_INVALID',
            message: err.message,
          },
        });
      }
      throw err;
    }
  }
}
