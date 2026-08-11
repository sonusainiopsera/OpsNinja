/**
 * AiAdminController — WO-063.
 *
 * Admin API surface for per-tenant AI policy settings and usage.
 *
 * Routes (all under /api/v1/admin/ai):
 *   GET  /settings  — read calling tenant's AI settings
 *   PUT  /settings  — update with optimistic-concurrency guard
 *   GET  /usage     — current/previous period token consumption
 *
 * RBAC: admin:manage_tenant (admin role only).
 * Errors follow the standard { error: { code, message, details[], traceId } } envelope.
 */

import {
  Controller,
  Get,
  Put,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AiPolicyService } from './ai-policy.service';
import {
  UpdateAiSettingsSchema,
  AiUsageQuerySchema,
  type UpdateAiSettingsDto,
  type AiUsageQueryDto,
} from './dto/update-ai-settings.dto';

@Controller('admin/ai')
export class AiAdminController {
  constructor(private readonly policyService: AiPolicyService) {}

  // --------------------------------------------------------------------------
  // GET /api/v1/admin/ai/settings
  // --------------------------------------------------------------------------

  @Get('settings')
  @RequirePermission('admin:manage_tenant')
  async getSettings(@Req() req: Request) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.policyService.getSettings();
    return { data, traceId };
  }

  // --------------------------------------------------------------------------
  // PUT /api/v1/admin/ai/settings
  // --------------------------------------------------------------------------

  @Put('settings')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('admin:manage_tenant')
  async updateSettings(
    @Body(new ZodValidationPipe(UpdateAiSettingsSchema)) dto: UpdateAiSettingsDto,
    @Req() req: Request,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.policyService.updateSettings(dto);
    return { data, traceId };
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/admin/ai/usage
  // --------------------------------------------------------------------------

  @Get('usage')
  @RequirePermission('admin:manage_tenant')
  async getUsage(
    @Query(new ZodValidationPipe(AiUsageQuerySchema)) query: AiUsageQueryDto,
    @Req() req: Request,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.policyService.getUsage(query.period);
    return { data, traceId };
  }
}
