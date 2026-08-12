/**
 * JiraDlqController — DLQ inspection and replay endpoints (WO-056).
 *
 * Routes:
 *   GET  /integrations/jira/dlq                  — list dead-lettered items (paginated)
 *   POST /integrations/jira/dlq/:id/replay        — re-enqueue a single item
 *   POST /integrations/jira/dlq/replay            — re-enqueue a filtered batch (capped)
 *
 * RBAC: jira:manage only — operator-level action, not exposed to regular agents.
 *
 * All replay calls write audit records so operators can trace who triggered
 * a replay and when, satisfying the audited-replay constraint.
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
  Optional,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { getPrincipalContext } from '../../../observability/request-context';
import { JiraDlqService, MAX_BATCH } from './jira-dlq.service';
import type {
  DlqListResponse,
  ReplaySingleResponse,
  ReplayBatchResponse,
} from './jira-dlq.service';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const ReplayBatchSchema = z.object({
  ids: z.array(z.string().uuid()).max(MAX_BATCH).optional(),
  connectionId: z.string().uuid().optional(),
  eventType: z.string().max(128).optional(),
  max: z.number().int().min(1).max(MAX_BATCH).optional(),
});

type ReplayBatchBody = z.infer<typeof ReplayBatchSchema>;

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('integrations/jira/dlq')
export class JiraDlqController {
  constructor(private readonly dlqService: JiraDlqService) {}

  // --------------------------------------------------------------------------
  // GET /integrations/jira/dlq
  // --------------------------------------------------------------------------

  @Get()
  @RequirePermission('jira:manage')
  async list(
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('connectionId') connectionId?: string,
    @Query('eventType') eventType?: string,
  ): Promise<DlqListResponse> {
    const principal = getPrincipalContext();
    return this.dlqService.list(
      {
        tenantId: principal.tenantId,
        cursor,
        limit: Math.min(limit ?? 50, 200),
        connectionId,
        eventType,
      },
      principal,
    );
  }

  // --------------------------------------------------------------------------
  // POST /integrations/jira/dlq/:id/replay  (single item)
  // --------------------------------------------------------------------------

  @Post(':id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('jira:manage')
  async replaySingle(@Param('id') id: string): Promise<ReplaySingleResponse> {
    const principal = getPrincipalContext();
    return this.dlqService.replaySingle(id, principal);
  }

  // --------------------------------------------------------------------------
  // POST /integrations/jira/dlq/replay  (batch)
  // --------------------------------------------------------------------------

  @Post('replay')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('jira:manage')
  async replayBatch(@Body() body: ReplayBatchBody): Promise<ReplayBatchResponse> {
    // Validate body against schema
    const parsed = ReplayBatchSchema.safeParse(body ?? {});
    if (!parsed.success) {
      const { BadRequestException } = require('@nestjs/common');
      throw new BadRequestException({
        error: { code: 'INVALID_BODY', message: 'Invalid replay batch request body.' },
      });
    }

    const principal = getPrincipalContext();
    return this.dlqService.replayBatch(parsed.data, principal);
  }
}
