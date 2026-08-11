/**
 * JiraConnectionsController — CRUD endpoints for Jira connections.
 *
 * Routes:
 *   POST   /integrations/jira/connections           (api_token variant)
 *   GET    /integrations/jira/connections           (list)
 *   GET    /integrations/jira/connections/:id       (get)
 *   POST   /integrations/jira/connections/:id/test  (probe)
 *   DELETE /integrations/jira/connections/:id       (revoke)
 *
 * RBAC: jira:manage for writes, jira:read for reads.
 * Cross-tenant ids return 404 (existence non-disclosure via RLS).
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  UsePipes,
  Inject,
} from '@nestjs/common';
import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JiraConnectionsService } from './jira-connections.service';
import { JiraTokenProvider } from '../tokens/jira-token.provider';
import { getPrincipalContext } from '../../../observability/request-context';
import {
  CreateApiTokenConnectionSchema,
  ListConnectionsQuerySchema,
  type CreateApiTokenConnectionDto,
  type ListConnectionsQueryDto,
  type JiraConnectionResponse,
  type PaginatedConnectionsResponse,
  type TestConnectionResponse,
} from './dto/jira-connection.dto';

@Controller('integrations/jira/connections')
export class JiraConnectionsController {
  constructor(
    private readonly service: JiraConnectionsService,
    private readonly tokenProvider: JiraTokenProvider,
  ) {}

  // --------------------------------------------------------------------------
  // Create with API token (Data Center)
  // --------------------------------------------------------------------------

  @Post()
  @RequirePermission('jira:manage')
  @UsePipes(new ZodValidationPipe(CreateApiTokenConnectionSchema))
  @HttpCode(201)
  async createWithApiToken(
    @Body() dto: CreateApiTokenConnectionDto,
  ): Promise<JiraConnectionResponse> {
    const { tenantId, userId } = getPrincipalContext();
    return this.service.createWithApiToken(tenantId, userId, dto);
  }

  // --------------------------------------------------------------------------
  // List
  // --------------------------------------------------------------------------

  @Get()
  @RequirePermission('jira:read', 'jira:manage')
  async list(
    @Query(new ZodValidationPipe(ListConnectionsQuerySchema)) query: ListConnectionsQueryDto,
  ): Promise<PaginatedConnectionsResponse> {
    const { tenantId } = getPrincipalContext();
    return this.service.list(tenantId, query.limit, query.cursor);
  }

  // --------------------------------------------------------------------------
  // Get by ID
  // --------------------------------------------------------------------------

  @Get(':id')
  @RequirePermission('jira:read', 'jira:manage')
  async getById(@Param('id') id: string): Promise<JiraConnectionResponse> {
    const { tenantId } = getPrincipalContext();
    return this.service.getById(tenantId, id);
  }

  // --------------------------------------------------------------------------
  // Test connection
  // --------------------------------------------------------------------------

  @Post(':id/test')
  @RequirePermission('jira:read', 'jira:manage')
  @HttpCode(200)
  async test(@Param('id') id: string): Promise<TestConnectionResponse> {
    const { tenantId, userId } = getPrincipalContext();
    const accessToken = await this.tokenProvider.getAccessToken(tenantId, id);
    return this.service.testConnection(tenantId, id, accessToken);
  }

  // --------------------------------------------------------------------------
  // Revoke (soft delete — keeps link records for history)
  // --------------------------------------------------------------------------

  @Delete(':id')
  @RequirePermission('jira:manage')
  @HttpCode(204)
  async revoke(@Param('id') id: string): Promise<void> {
    const { tenantId } = getPrincipalContext();
    return this.service.revoke(tenantId, id);
  }
}
