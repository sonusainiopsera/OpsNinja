/**
 * OrganizationsController — REST surface for organization CRUD + lifecycle.
 *
 * Endpoint map (all under /api/v1/organizations):
 *   GET    /                     List with cursor pagination + filters
 *   GET    /:id                  Single organization profile with detail counts
 *   POST   /                     Create new organization
 *   PATCH  /:id                  Partial update with optimistic concurrency
 *   POST   /:id/deactivate       Mark organization inactive (idempotent)
 *   POST   /:id/reactivate       Restore organization to active (idempotent)
 *
 * No DELETE — lifecycle is deactivate-only to preserve ticket history.
 *
 * Access control:
 *   Reads      → org:read      (agent-or-above)
 *   Writes     → org:create / org:update  (admin/manager)
 *   Lifecycle  → org:deactivate           (admin only)
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { getPrincipalContext } from '../../observability/request-context';
import { OrganizationsService } from './organizations.service';
import {
  CreateOrganizationSchema,
  type CreateOrganizationDto,
} from './dto/create-organization.dto';
import {
  UpdateOrganizationSchema,
  type UpdateOrganizationDto,
} from './dto/update-organization.dto';
import {
  ListOrganizationsQuerySchema,
  type ListOrganizationsQuery,
} from './dto/list-organizations.query';
import {
  DeactivateOrganizationSchema,
  type DeactivateOrganizationDto,
} from './dto/deactivate-organization.dto';
import {
  ReactivateOrganizationSchema,
  type ReactivateOrganizationDto,
} from './dto/reactivate-organization.dto';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  // --------------------------------------------------------------------------
  // GET /api/v1/organizations
  // --------------------------------------------------------------------------

  @Get()
  @RequirePermission('org:read')
  async list(
    @Query(new ZodValidationPipe(ListOrganizationsQuerySchema)) query: ListOrganizationsQuery,
    @Req() req: Request,
  ) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const result = await this.service.list(tenantId, query);

    return {
      data: result.data,
      nextCursor: result.nextCursor,
      traceId,
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/organizations/:id
  // --------------------------------------------------------------------------

  @Get(':id')
  @RequirePermission('org:read')
  async getById(@Param('id') id: string, @Req() req: Request) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const org = await this.service.getById(tenantId, id);

    return { data: org, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/organizations
  // --------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('org:create')
  async create(
    @Body(new ZodValidationPipe(CreateOrganizationSchema)) dto: CreateOrganizationDto,
    @Req() req: Request,
  ) {
    const { tenantId, userId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const org = await this.service.create(tenantId, dto, userId, traceId);

    return { data: org, traceId };
  }

  // --------------------------------------------------------------------------
  // PATCH /api/v1/organizations/:id
  // --------------------------------------------------------------------------

  @Patch(':id')
  @RequirePermission('org:update')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateOrganizationSchema)) dto: UpdateOrganizationDto,
    @Req() req: Request,
  ) {
    const { tenantId, userId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const org = await this.service.update(tenantId, id, dto, userId, traceId);

    return { data: org, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/organizations/:id/deactivate
  // --------------------------------------------------------------------------

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org:deactivate')
  async deactivate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DeactivateOrganizationSchema)) dto: DeactivateOrganizationDto,
    @Req() req: Request,
  ) {
    const { tenantId, userId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const org = await this.service.deactivate(tenantId, id, dto, userId, traceId);

    return {
      data: {
        id: org.id,
        status: org.status,
        deactivatedAt: org.deactivatedAt,
        deactivatedBy: org.deactivatedBy,
        version: org.version,
      },
      traceId,
    };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/organizations/:id/reactivate
  // --------------------------------------------------------------------------

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org:deactivate')
  async reactivate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReactivateOrganizationSchema)) dto: ReactivateOrganizationDto,
    @Req() req: Request,
  ) {
    const { tenantId, userId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const org = await this.service.reactivate(tenantId, id, dto, userId, traceId);

    return {
      data: {
        id: org.id,
        status: org.status,
        version: org.version,
      },
      traceId,
    };
  }
}
