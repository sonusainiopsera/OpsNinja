import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { Permission } from '../../../common/auth/permissions';
import type { PrincipalContext } from '../../../observability/request-context';
import { JiraConnectionsService } from './jira-connections.service';
import {
  StartOAuthSchema,
  OAuthCallbackQuerySchema,
  CreateApiTokenConnectionSchema,
  ListConnectionsQuerySchema,
} from '../dto/jira-connections.dto';

type AuthRequest = Request & { user?: PrincipalContext };

@Controller('api/v1/integrations/jira/connections')
export class JiraConnectionsController {
  constructor(private readonly service: JiraConnectionsService) {}

  // ── OAuth start ─────────────────────────────────────────────────────────────

  @Post('oauth/start')
  @RequirePermission(Permission.JIRA_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async startOAuth(@Body() rawBody: unknown) {
    const dto = parseBody(StartOAuthSchema, rawBody);
    const result = await this.service.startOAuth(dto);
    return { data: result };
  }

  // ── OAuth callback ──────────────────────────────────────────────────────────

  @Get('oauth/callback')
  async oauthCallback(
    @Query() rawQuery: unknown,
    @Res() res: Response,
  ) {
    const parsed = OAuthCallbackQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      const err = parsed.error;
      return res.status(400).json({
        error: {
          code: 'INVALID_CALLBACK',
          message: 'OAuth callback parameters are invalid.',
          details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
        },
      });
    }

    try {
      await this.service.handleOAuthCallback(parsed.data);
      return res.redirect(302, '/console');
    } catch (err: unknown) {
      const code = (err as { response?: { code?: string } }).response?.code ?? 'CALLBACK_FAILED';
      const message = (err as { message?: string }).message ?? 'OAuth callback failed.';
      return res.status(400).json({
        error: { code, message },
      });
    }
  }

  // ── API token connection ────────────────────────────────────────────────────

  @Post()
  @RequirePermission(Permission.JIRA_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async createApiToken(@Body() rawBody: unknown) {
    const dto = parseBody(CreateApiTokenConnectionSchema, rawBody);
    const result = await this.service.createApiTokenConnection(dto);
    return { data: result };
  }

  // ── List connections ────────────────────────────────────────────────────────

  @Get()
  @RequirePermission(Permission.JIRA_MANAGE)
  async list(@Query() rawQuery: unknown) {
    const query = parseBody(ListConnectionsQuerySchema, rawQuery);
    return this.service.listConnections(query);
  }

  // ── Get one ─────────────────────────────────────────────────────────────────

  @Get(':id')
  @RequirePermission(Permission.JIRA_MANAGE)
  async getOne(@Param('id') id: string) {
    const result = await this.service.getConnection(id);
    return { data: result };
  }

  // ── Test connection ─────────────────────────────────────────────────────────

  @Post(':id/test')
  @RequirePermission(Permission.JIRA_MANAGE)
  async test(@Param('id') id: string) {
    const result = await this.service.testConnection(id);
    return { data: result };
  }

  // ── Revoke connection ───────────────────────────────────────────────────────

  @Delete(':id')
  @RequirePermission(Permission.JIRA_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Param('id') id: string) {
    await this.service.revokeConnection(id);
  }
}

function parseBody<T>(schema: { parse(v: unknown): T }, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new UnprocessableEntityException({
        code: 'SCHEMA_VIOLATION',
        message: 'Request body did not match the expected schema.',
        details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
      });
    }
    throw err;
  }
}
