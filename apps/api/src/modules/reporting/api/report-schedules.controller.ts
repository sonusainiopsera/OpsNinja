/**
 * ReportSchedulesController — CRUD for report schedules (WO-075).
 *
 * Routes (nested under /reports/:reportId):
 *   POST   /reports/:reportId/schedule       — create or replace schedule (Lead)
 *   GET    /reports/:reportId/schedule       — get current schedule
 *   PATCH  /reports/:reportId/schedule       — update schedule (Lead)
 *   DELETE /reports/:reportId/schedule       — delete schedule (Lead)
 *
 * RBAC:
 *   report:manage — required for POST, PATCH, DELETE (Lead role only)
 *   report:read   — required for GET
 *
 * Cadence allow-list, minimum-interval and recipient-domain validation are
 * enforced at the service layer. API-level validation is Zod via ZodValidationPipe.
 */

import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  NotFoundException,
  UsePipes,
} from '@nestjs/common';
import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ReportSchedulesService } from '../application/report-schedules.service';
import { getPrincipalContext } from '../../../observability/request-context';
import {
  CreateScheduleSchema,
  UpdateScheduleSchema,
  type CreateScheduleDto,
  type UpdateScheduleDto,
  type ScheduleResponse,
} from './dto/report-schedule.dto';

@Controller('reports/:reportId/schedule')
export class ReportSchedulesController {
  constructor(private readonly service: ReportSchedulesService) {}

  // --------------------------------------------------------------------------
  // POST /reports/:reportId/schedule — create schedule
  // --------------------------------------------------------------------------

  @Post()
  @HttpCode(201)
  @RequirePermission('report:manage')
  @UsePipes(new ZodValidationPipe(CreateScheduleSchema))
  async create(
    @Param('reportId') reportId: string,
    @Body() dto: CreateScheduleDto,
  ): Promise<ScheduleResponse> {
    const { tenantId, userId } = getPrincipalContext();
    return this.service.create(reportId, dto, { tenantId, userId: userId! });
  }

  // --------------------------------------------------------------------------
  // GET /reports/:reportId/schedule — get schedule
  // --------------------------------------------------------------------------

  @Get()
  @RequirePermission('report:read', 'report:manage')
  async get(@Param('reportId') reportId: string): Promise<ScheduleResponse> {
    const { tenantId } = getPrincipalContext();
    const schedule = await this.service.getByDefinitionId(reportId, tenantId);
    if (!schedule) {
      throw new NotFoundException({
        error: { code: 'SCHEDULE_NOT_FOUND', message: 'No schedule found for this report.' },
      });
    }
    return schedule;
  }

  // --------------------------------------------------------------------------
  // PATCH /reports/:reportId/schedule — update schedule
  // --------------------------------------------------------------------------

  @Patch()
  @RequirePermission('report:manage')
  @UsePipes(new ZodValidationPipe(UpdateScheduleSchema))
  async update(
    @Param('reportId') reportId: string,
    @Body() dto: UpdateScheduleDto,
  ): Promise<ScheduleResponse> {
    const { tenantId, userId } = getPrincipalContext();
    return this.service.update(reportId, dto, { tenantId, userId: userId! });
  }

  // --------------------------------------------------------------------------
  // DELETE /reports/:reportId/schedule — delete schedule
  // --------------------------------------------------------------------------

  @Delete()
  @HttpCode(204)
  @RequirePermission('report:manage')
  async delete(@Param('reportId') reportId: string): Promise<void> {
    const { tenantId, userId } = getPrincipalContext();
    return this.service.delete(reportId, { tenantId, userId: userId! });
  }
}
