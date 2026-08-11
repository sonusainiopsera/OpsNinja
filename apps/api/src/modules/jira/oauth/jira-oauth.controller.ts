/**
 * JiraOAuthController — OAuth 2.0 3LO handshake endpoints.
 *
 * Routes:
 *   POST /integrations/jira/connections/oauth/start    (initiates PKCE flow)
 *   GET  /integrations/jira/connections/oauth/callback (exchanges code, @Public)
 *
 * The callback is @Public because Atlassian redirects the user's browser here
 * without a Bearer token. Security is provided by the single-use state token
 * stored in Redis (bound to tenantId + actorId at start time).
 *
 * The callback also uses @NoTenantContext because TenantContextInterceptor
 * expects a JWT principal, which is absent on a browser redirect. The service
 * calls withTenantTransaction() directly with a synthetic PrincipalContext.
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  UsePipes,
  Redirect,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { Public } from '../../../common/auth/public.decorator';
import { NoTenantContext } from '../../../common/tenant/no-tenant-context.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JiraConnectionsService } from '../connections/jira-connections.service';
import { getPrincipalContext } from '../../../observability/request-context';
import {
  OAuthStartSchema,
  OAuthCallbackSchema,
  type OAuthStartDto,
  type OAuthCallbackDto,
  type OAuthStartResponse,
  type JiraConnectionResponse,
} from '../connections/dto/jira-connection.dto';

const CONSOLE_JIRA_URL = process.env['CONSOLE_URL']
  ? `${process.env['CONSOLE_URL']}/integrations/jira`
  : 'http://localhost:3001/integrations/jira';

@Controller('integrations/jira/connections/oauth')
export class JiraOAuthController {
  constructor(private readonly service: JiraConnectionsService) {}

  // --------------------------------------------------------------------------
  // Start OAuth flow
  // --------------------------------------------------------------------------

  @Post('start')
  @RequirePermission('jira:manage')
  @UsePipes(new ZodValidationPipe(OAuthStartSchema))
  @HttpCode(201)
  async start(@Body() dto: OAuthStartDto): Promise<OAuthStartResponse> {
    const { tenantId, userId } = getPrincipalContext();
    return this.service.startOAuth(tenantId, userId, dto);
  }

  // --------------------------------------------------------------------------
  // OAuth callback (browser redirect from Atlassian)
  // --------------------------------------------------------------------------

  @Get('callback')
  @Public()
  @NoTenantContext()
  async callback(
    @Query(new ZodValidationPipe(OAuthCallbackSchema)) query: OAuthCallbackDto,
    @Res() res: Response,
  ): Promise<void> {
    const traceId = randomUUID();
    try {
      await this.service.handleOAuthCallback(query.code, query.state, traceId);
      res.redirect(`${CONSOLE_JIRA_URL}?connected=true`);
    } catch (err: unknown) {
      const code = extractErrorCode(err) ?? 'OAUTH_ERROR';
      res.redirect(`${CONSOLE_JIRA_URL}?error=${encodeURIComponent(code)}`);
    }
  }
}

function extractErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null) {
    const typed = err as { response?: { error?: { code?: string } }; message?: string };
    return typed.response?.error?.code ?? undefined;
  }
  return undefined;
}
