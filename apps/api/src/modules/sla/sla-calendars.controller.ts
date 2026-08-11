/**
 * SlaCalendarsController — REST surface for SLA calendar management.
 *
 * Endpoints:
 *   GET    /api/v1/sla-calendars         — cursor-paginated list
 *   POST   /api/v1/sla-calendars         — create with nested windows/holidays
 *   GET    /api/v1/sla-calendars/:id     — get by id with windows/holidays
 *   PUT    /api/v1/sla-calendars/:id     — update (replaces windows/holidays if provided)
 *   POST   /api/v1/sla-calendars/:id/deactivate — soft-deactivate
 *
 * RBAC: same as sla-policies — sla:manage for writes, sla:read for reads.
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { SlaCalendarsService } from './sla-calendars.service';
import {
  CreateCalendarSchema,
  UpdateCalendarSchema,
  type CreateCalendarDto,
  type UpdateCalendarDto,
} from './dto/sla-policy.dto';
import { getPrincipalContext } from '../../observability/request-context';

@Controller('sla-calendars')
export class SlaCalendarsController {
  private readonly logger = new Logger(SlaCalendarsController.name);

  constructor(private readonly service: SlaCalendarsService) {}

  private ctx() {
    const { tenantId, userId } = getPrincipalContext();
    return { tenantId, actorId: userId };
  }

  @Get()
  @RequirePermission('sla:read', 'sla:manage')
  async list(
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ) {
    const { tenantId } = this.ctx();
    const limit = limitStr ? Math.min(parseInt(limitStr, 10) || 50, 100) : 50;
    return this.service.list(tenantId, limit, cursor);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('sla:manage')
  async create(@Body(new ZodValidationPipe(CreateCalendarSchema)) dto: CreateCalendarDto) {
    const { tenantId, actorId } = this.ctx();
    const result = await this.service.create(tenantId, dto, actorId);
    return { data: result };
  }

  @Get(':id')
  @RequirePermission('sla:read', 'sla:manage')
  async getById(@Param('id') id: string) {
    const { tenantId } = this.ctx();
    const result = await this.service.getById(tenantId, id);
    return { data: result };
  }

  @Put(':id')
  @RequirePermission('sla:manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCalendarSchema)) dto: UpdateCalendarDto,
  ) {
    const { tenantId, actorId } = this.ctx();
    const result = await this.service.update(tenantId, id, dto, actorId);
    return { data: result };
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('sla:manage')
  async deactivate(@Param('id') id: string) {
    const { tenantId } = this.ctx();
    const result = await this.service.deactivate(tenantId, id);
    return { data: result };
  }
}
