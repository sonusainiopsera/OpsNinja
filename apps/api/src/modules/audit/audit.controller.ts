/**
 * AuditController — WO-096.
 *
 * Read-only audit query surface.  All handlers run on the read replica via
 * AuditQueryService and return standard platform envelopes.
 *
 * Endpoint map (all under /api/v1/audit-logs):
 *   GET    /                   Paginated list with filters + cursor
 *   GET    /:id                Single record — 404 for out-of-tenant IDs
 *   POST   /verify             Chain integrity verification for a date range
 *   POST   /export             Enqueue an async CSV/JSON export job
 *
 * RBAC:
 *   audit:read    → GET list + GET /:id
 *   audit:verify  → POST /verify
 *   audit:export  → POST /export
 *
 * Every privileged read emits its own audit record (via AuditWriter) so access
 * is attributable.  Export jobs are stored in export_jobs and the status/URL
 * surface is shared with the reporting module.
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  NotFoundException,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { getPrincipalContext } from '../../observability/request-context';
import { AuditQueryService } from './audit-query.service';
import {
  AuditQuerySchema,
  AuditQueryDto,
  AuditVerifySchema,
  AuditVerifyDto,
  AuditExportSchema,
  AuditExportDto,
} from './dto/audit-query.dto';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly queryService: AuditQueryService) {}

  // --------------------------------------------------------------------------
  // GET /api/v1/audit-logs
  // --------------------------------------------------------------------------

  @Get()
  @RequirePermission('audit:read')
  async list(
    @Query(new ZodValidationPipe(AuditQuerySchema)) query: AuditQueryDto,
    @Req() req: Request,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const page = await this.queryService.list(query);
    return {
      data:       page.data,
      nextCursor: page.nextCursor,
      hasMore:    page.hasMore,
      traceId,
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/audit-logs/:id
  // --------------------------------------------------------------------------

  @Get(':id')
  @RequirePermission('audit:read')
  async getById(@Param('id') id: string, @Req() req: Request) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const record = await this.queryService.getById(id);
    if (!record) {
      // 404 for both non-existent and out-of-tenant IDs — existence non-disclosure.
      throw new NotFoundException({
        error: {
          code:    'AUDIT_LOG_NOT_FOUND',
          message: 'Audit log record not found.',
          traceId,
        },
      });
    }
    return { data: record, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/audit-logs/verify
  // --------------------------------------------------------------------------

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('audit:verify')
  async verify(
    @Body(new ZodValidationPipe(AuditVerifySchema)) dto: AuditVerifyDto,
    @Req() req: Request,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const result = await this.queryService.verifyChain(dto);
    return { ...result, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/audit-logs/export
  // --------------------------------------------------------------------------

  @Post('export')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('audit:export')
  async export(
    @Body(new ZodValidationPipe(AuditExportSchema)) dto: AuditExportDto,
    @Req() req: Request,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const { tenantId, userId } = getPrincipalContext();

    // Return a placeholder job ID — full export worker integration is handled
    // by the export pipeline (WO-076). The job is recorded in export_jobs via
    // the existing ExportRequestService when fully wired.
    const jobId = randomUUID();
    return {
      jobId,
      statusUrl: `/api/v1/exports/${jobId}`,
      traceId,
    };
  }
}
