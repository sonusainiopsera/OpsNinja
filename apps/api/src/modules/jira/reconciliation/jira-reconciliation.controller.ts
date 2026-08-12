/**
 * JiraReconciliationController — WO-057 AC2, AC7.
 *
 * Routes:
 *   POST /integrations/jira/connections/:id/reconcile
 *     body { lookbackHours: 1..168 } → 202 { runId }
 *     Returns 409 if a run is already active.
 *
 *   GET /integrations/jira/connections/:id/reconciliation-runs
 *     query { cursor?, limit? } → 200 { data: [...], nextCursor }
 *
 * RBAC: jira:manage (Integration-Admin only).
 */

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { getPrincipalContext } from '../../../observability/request-context';
import { JiraReconciliationService } from './jira-reconciliation.service';
import { RECON_LOOKBACK_MAX_HOURS, RECON_LOOKBACK_DEFAULT_HOURS } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const TriggerReconcileSchema = z
  .object({
    lookbackHours: z
      .number()
      .int()
      .min(1)
      .max(RECON_LOOKBACK_MAX_HOURS)
      .default(RECON_LOOKBACK_DEFAULT_HOURS),
  })
  .strict();

type TriggerReconcileBody = z.infer<typeof TriggerReconcileSchema>;

const ListRunsQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z
      .string()
      .optional()
      .transform((v) => (v === undefined ? 20 : Math.min(parseInt(v, 10) || 20, 100))),
  })
  .strict();

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('integrations/jira/connections')
export class JiraReconciliationController {
  constructor(private readonly reconcileService: JiraReconciliationService) {}

  // --------------------------------------------------------------------------
  // POST /integrations/jira/connections/:id/reconcile
  // --------------------------------------------------------------------------

  @Post(':id/reconcile')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('jira:manage')
  async triggerReconcile(
    @Param('id') connectionId: string,
    @Body() body: unknown,
  ) {
    const { tenantId } = getPrincipalContext();

    // Validate body
    const parsed = TriggerReconcileSchema.safeParse(body ?? {});
    if (!parsed.success) {
      const { BadRequestException } = require('@nestjs/common');
      throw new BadRequestException({
        error: {
          code: 'INVALID_BODY',
          message: 'Invalid reconcile request body.',
          details: parsed.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
      });
    }

    return this.reconcileService.triggerReconcile(
      tenantId,
      connectionId,
      parsed.data.lookbackHours,
    );
  }

  // --------------------------------------------------------------------------
  // GET /integrations/jira/connections/:id/reconciliation-runs
  // --------------------------------------------------------------------------

  @Get(':id/reconciliation-runs')
  @RequirePermission('jira:manage', 'jira:read')
  async listReconciliationRuns(
    @Param('id') connectionId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
  ) {
    const { tenantId } = getPrincipalContext();

    const queryParsed = ListRunsQuerySchema.safeParse({ cursor, limit: limitStr });
    if (!queryParsed.success) {
      const { BadRequestException } = require('@nestjs/common');
      throw new BadRequestException({
        error: {
          code: 'INVALID_QUERY',
          message: 'Invalid query parameters.',
          details: queryParsed.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
      });
    }

    return this.reconcileService.listRuns(
      tenantId,
      connectionId,
      queryParsed.data.limit,
      queryParsed.data.cursor,
    );
  }
}
