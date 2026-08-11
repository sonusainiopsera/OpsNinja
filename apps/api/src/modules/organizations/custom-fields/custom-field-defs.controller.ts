/**
 * CustomFieldDefsController — REST surface for custom field definition management.
 *
 * All routes are under /api/v1/organizations/custom-fields.
 * (The @Controller prefix 'organizations/custom-fields' is more specific than
 * 'organizations/:id' so NestJS matches it first — no route shadowing.)
 *
 * Endpoint map:
 *   GET    /                     List all definitions (active + archived)
 *   POST   /                     Create a new definition
 *   PATCH  /:id                  Update label, required, options (additive), constraints
 *   POST   /:id/archive          Archive a definition (soft delete)
 *   PUT    /reorder              Batch reorder by display_order
 *
 * Access control: org:manage_fields for all writes; org:read for GET.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UnprocessableEntityException,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { getPrincipalContext } from '../../../observability/request-context';
import { CustomFieldDefsService } from './custom-field-defs.service';
import {
  CreateCustomFieldDefSchema,
  UpdateCustomFieldDefSchema,
  ReorderCustomFieldDefsSchema,
  type CreateCustomFieldDefDto,
  type UpdateCustomFieldDefDto,
  type ReorderCustomFieldDefsDto,
} from './dto/custom-field-def.dto';

@Controller('organizations/custom-fields')
export class CustomFieldDefsController {
  constructor(private readonly service: CustomFieldDefsService) {}

  // --------------------------------------------------------------------------
  // GET /api/v1/organizations/custom-fields
  // --------------------------------------------------------------------------

  @Get()
  @RequirePermission('org:read')
  async list(@Req() req: Request) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const defs = await this.service.listAll(tenantId);

    return { data: defs, traceId };
  }

  // --------------------------------------------------------------------------
  // PUT /api/v1/organizations/custom-fields/reorder
  // (Declared BEFORE /:id routes to avoid NestJS matching 'reorder' as :id)
  // --------------------------------------------------------------------------

  @Put('reorder')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org:manage_fields')
  async reorder(
    @Body(new ZodValidationPipe(ReorderCustomFieldDefsSchema)) dto: ReorderCustomFieldDefsDto,
    @Req() req: Request,
  ) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    await this.service.reorder(tenantId, dto);

    return { data: { reordered: dto.ids.length }, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/organizations/custom-fields
  // --------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('org:manage_fields')
  async create(
    @Body(new ZodValidationPipe(CreateCustomFieldDefSchema)) dto: CreateCustomFieldDefDto,
    @Req() req: Request,
  ) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const def = await this.service.create(tenantId, dto);

    return { data: def, traceId };
  }

  // --------------------------------------------------------------------------
  // PATCH /api/v1/organizations/custom-fields/:id
  // --------------------------------------------------------------------------

  @Patch(':id')
  @RequirePermission('org:manage_fields')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCustomFieldDefSchema)) dto: UpdateCustomFieldDefDto,
    @Req() req: Request,
  ) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    // Reject attempts to change fieldKey (immutability enforcement at HTTP layer)
    const body = req.body as Record<string, unknown>;
    if ('fieldKey' in body) {
      throw new UnprocessableEntityException({
        error: {
          code: 'FIELD_KEY_IMMUTABLE',
          message: 'field_key cannot be changed after creation.',
          traceId,
        },
      });
    }

    const def = await this.service.update(tenantId, id, dto);

    return { data: def, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/organizations/custom-fields/:id/archive
  // --------------------------------------------------------------------------

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('org:manage_fields')
  async archive(@Param('id') id: string, @Req() req: Request) {
    const { tenantId } = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const def = await this.service.archive(tenantId, id);

    return { data: def, traceId };
  }
}
