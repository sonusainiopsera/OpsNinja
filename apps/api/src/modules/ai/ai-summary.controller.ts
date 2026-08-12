/**
 * AiSummaryController — WO-065.
 *
 * Agent-facing endpoints for AI summary read, edit and regenerate.
 *
 * Routes (under /api/v1/tickets):
 *   GET  /:id/ai-summary              — read crux, resolution, affected areas
 *   PATCH /:id/ai-summary             — human edit (version-gated, audited)
 *   POST  /:id/ai-summary/regenerate  — re-enqueue synthesis (rate-limited)
 *
 * RBAC:
 *   GET       — ai:read  (agents, managers, admins)
 *   PATCH     — ai:manage (agents and above)
 *   regenerate — ai:manage
 *
 * Portal principals are blocked via service-layer 404 (existence non-disclosure).
 *
 * This controller is NOT registered on the portal API surface (PortalModule).
 */

import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AiSummaryService } from './ai-summary.service';
import { UpdateAiSummarySchema, type UpdateAiSummaryDto } from './dto/update-ai-summary.dto';

@Controller('tickets')
export class AiSummaryController {
  constructor(private readonly aiSummaryService: AiSummaryService) {}

  // --------------------------------------------------------------------------
  // GET /api/v1/tickets/:id/ai-summary
  // --------------------------------------------------------------------------

  @Get(':id/ai-summary')
  @RequirePermission('ai:read')
  async getAiSummary(@Param('id') ticketId: string, @Req() req: Request) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.aiSummaryService.getForTicket(ticketId);
    return { data, traceId };
  }

  // --------------------------------------------------------------------------
  // PATCH /api/v1/tickets/:id/ai-summary
  // --------------------------------------------------------------------------

  @Patch(':id/ai-summary')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ai:manage')
  async updateAiSummary(
    @Param('id') ticketId: string,
    @Body(new ZodValidationPipe(UpdateAiSummarySchema)) dto: UpdateAiSummaryDto,
    @Req() req: Request,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.aiSummaryService.updateForTicket(ticketId, dto);
    return { data, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/tickets/:id/ai-summary/regenerate
  // --------------------------------------------------------------------------

  @Post(':id/ai-summary/regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('ai:manage')
  async regenerateAiSummary(@Param('id') ticketId: string, @Req() req: Request) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.aiSummaryService.requestRegenerate(ticketId);
    return { data, traceId };
  }
}
