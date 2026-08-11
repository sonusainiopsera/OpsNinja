/**
 * SlaPoliciesController — REST surface for SLA policy management.
 *
 * Endpoints:
 *   GET    /api/v1/sla-policies         — cursor-paginated list
 *   POST   /api/v1/sla-policies         — create (sla_policy:write)
 *   GET    /api/v1/sla-policies/:id     — get by id (sla_policy:read)
 *   PUT    /api/v1/sla-policies/:id     — update with optimistic locking
 *   POST   /api/v1/sla-policies/:id/deactivate — soft-deactivate
 *
 * RBAC: Manager and Administrator have sla:manage; Agent has sla:read only.
 * Requests for a policy belonging to another tenant return 404 (RLS closes the gap).
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
  UsePipes,
  Logger,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { SlaPoliciesService } from './sla-policies.service';
import {
  CreatePolicySchema,
  UpdatePolicySchema,
  type CreatePolicyDto,
  type UpdatePolicyDto,
} from './dto/sla-policy.dto';
import { getPrincipalContext } from '../../observability/request-context';

@Controller('sla-policies')
export class SlaPoliciesController {
  private readonly logger = new Logger(SlaPoliciesController.name);

  constructor(private readonly service: SlaPoliciesService) {}

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
  @UsePipes(new ZodValidationPipe(CreatePolicySchema))
  async create(@Body() dto: CreatePolicyDto) {
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
  @UsePipes(new ZodValidationPipe(UpdatePolicySchema))
  async update(@Param('id') id: string, @Body() dto: UpdatePolicyDto) {
    const { tenantId, actorId } = this.ctx();
    const result = await this.service.update(tenantId, id, dto, actorId);
    return { data: result };
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('sla:manage')
  async deactivate(@Param('id') id: string) {
    const { tenantId, actorId } = this.ctx();
    const result = await this.service.deactivate(tenantId, id, actorId);
    return { data: result };
  }
}
