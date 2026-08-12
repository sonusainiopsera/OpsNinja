/**
 * ReportsController — WO-074
 *
 * Routes:
 *   POST   /api/v1/reports/run          — preview run (Lead only)
 *   GET    /api/v1/reports              — list visible definitions (Lead/Agent)
 *   POST   /api/v1/reports              — create definition (Lead only)
 *   PATCH  /api/v1/reports/:id          — update definition (Lead only)
 *   DELETE /api/v1/reports/:id          — soft-delete definition (Lead only)
 *
 * RBAC:
 *   report:manage — POST run, POST definitions, PATCH, DELETE
 *   report:read   — GET list (Agent and above)
 *
 * Security:
 *   - Sharing never widens data access: the run endpoint always injects the
 *     caller's live orgScopeIds, never the definition's persisted scope.
 *   - Out-of-scope and non-existent definition ids both return 404.
 *   - Filter values are never logged; only a SHA-256 hash is emitted.
 */

import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  UsePipes,
} from '@nestjs/common';
import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { getPrincipalContext } from '../../../observability/request-context';

import { ReportRunService, type RunReportResult } from '../application/report-run.service';
import { ReportDefinitionService, type PaginatedDefinitions, type DefinitionSummary } from '../application/report-definition.service';

import {
  RunReportSchema,
  type RunReportDto,
} from './dto/run-report.dto';
import {
  CreateReportDefinitionSchema,
  UpdateReportDefinitionSchema,
  ListReportDefinitionsQuerySchema,
  type CreateReportDefinitionDto,
  type UpdateReportDefinitionDto,
  type ListReportDefinitionsQueryDto,
} from './dto/report-definition.dto';
import type { ReportDefinition } from '@opsninja/db';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly runService:        ReportRunService,
    private readonly definitionService: ReportDefinitionService,
  ) {}

  // --------------------------------------------------------------------------
  // POST /reports/run — synchronous preview (Lead only)
  // --------------------------------------------------------------------------

  @Post('run')
  @HttpCode(200)
  @RequirePermission('report:manage')
  @UsePipes(new ZodValidationPipe(RunReportSchema))
  async run(@Body() dto: RunReportDto): Promise<RunReportResult> {
    const ctx = getPrincipalContext();
    return this.runService.run(
      {
        tenantId:       ctx.tenantId,
        userId:         ctx.userId,
        roles:          ctx.roles,
        orgScopeIds:    ctx.orgScopeIds,
        traceId:        (ctx as Record<string, unknown>)['traceId'] as string ?? '',
      },
      dto,
    );
  }

  // --------------------------------------------------------------------------
  // GET /reports — list visible definitions (Lead + Agent)
  // --------------------------------------------------------------------------

  @Get()
  @RequirePermission('report:read', 'report:manage')
  async list(@Query() rawQuery: Record<string, string>): Promise<PaginatedDefinitions> {
    const parsed = ListReportDefinitionsQuerySchema.safeParse(rawQuery);
    const query = parsed.success
      ? parsed.data
      : { cursor: undefined, limit: 25 } satisfies ListReportDefinitionsQueryDto;
    const ctx = getPrincipalContext();
    return this.definitionService.list(
      ctx.tenantId,
      { userId: ctx.userId, tenantId: ctx.tenantId, roles: ctx.roles },
      query.limit,
      query.cursor,
    );
  }

  // --------------------------------------------------------------------------
  // POST /reports — create definition (Lead only)
  // --------------------------------------------------------------------------

  @Post()
  @HttpCode(201)
  @RequirePermission('report:manage')
  @UsePipes(new ZodValidationPipe(CreateReportDefinitionSchema))
  async create(@Body() dto: CreateReportDefinitionDto): Promise<ReportDefinition> {
    const ctx = getPrincipalContext();
    return this.definitionService.create(ctx.tenantId, ctx.userId, dto);
  }

  // --------------------------------------------------------------------------
  // PATCH /reports/:id — update definition (Lead only)
  // --------------------------------------------------------------------------

  @Patch(':id')
  @RequirePermission('report:manage')
  @UsePipes(new ZodValidationPipe(UpdateReportDefinitionSchema))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateReportDefinitionDto,
  ): Promise<ReportDefinition> {
    const ctx = getPrincipalContext();
    return this.definitionService.update(
      ctx.tenantId,
      id,
      dto,
      { userId: ctx.userId, tenantId: ctx.tenantId, roles: ctx.roles },
    );
  }

  // --------------------------------------------------------------------------
  // DELETE /reports/:id — soft-delete (Lead only)
  // --------------------------------------------------------------------------

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('report:manage')
  async delete(@Param('id') id: string): Promise<void> {
    const ctx = getPrincipalContext();
    return this.definitionService.delete(
      ctx.tenantId,
      id,
      { userId: ctx.userId, tenantId: ctx.tenantId, roles: ctx.roles },
    );
  }
}
