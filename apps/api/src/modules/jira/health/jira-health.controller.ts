/**
 * JiraHealthController — aggregated health and webhook-secret rotation (WO-058).
 *
 * Routes:
 *   GET  /integrations/jira/health                                    — health dashboard
 *   POST /integrations/jira/connections/:id/webhook-secret/rotate     — rotate signing secret (202)
 *
 * RBAC:
 *   jira:read   — GET health
 *   jira:manage — POST rotate
 *
 * The health endpoint returns 503 with stale:true when only cached data is
 * available and the live read fails; this is handled at the service layer.
 */

import {
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { JiraHealthService } from './jira-health.service';
import { getPrincipalContext } from '../../../observability/request-context';
import type { JiraHealthResponse, RotateWebhookSecretResponse } from './jira-health.dto';

@Controller('integrations/jira')
export class JiraHealthController {
  constructor(private readonly service: JiraHealthService) {}

  // --------------------------------------------------------------------------
  // GET /integrations/jira/health
  // --------------------------------------------------------------------------

  @Get('health')
  @RequirePermission('jira:read', 'jira:manage')
  async getHealth(): Promise<JiraHealthResponse> {
    const { tenantId } = getPrincipalContext();
    return this.service.getHealth(tenantId);
  }

  // --------------------------------------------------------------------------
  // POST /integrations/jira/connections/:id/webhook-secret/rotate
  // --------------------------------------------------------------------------

  @Post('connections/:id/webhook-secret/rotate')
  @HttpCode(200)
  @RequirePermission('jira:manage')
  async rotateWebhookSecret(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<RotateWebhookSecretResponse> {
    const { tenantId, userId } = getPrincipalContext();
    const baseUrl = `${req.protocol}://${req.get('host') ?? 'localhost'}`;
    return this.service.rotateWebhookSecret(tenantId, id, userId ?? null, baseUrl);
  }
}
