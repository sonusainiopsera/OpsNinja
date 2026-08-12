/**
 * ExportsController — WO-076
 *
 * Routes:
 *   POST /api/v1/exports          — request async CSV/PDF export (Lead only)
 *   GET  /api/v1/exports/:id      — poll job status and get presigned download URL
 *
 * RBAC:
 *   report:manage — required for POST (Lead role)
 *   report:read   — required for GET (Agent and above)
 *
 * Security:
 *   - Presigned URLs are minted on demand and NEVER persisted or logged.
 *   - Out-of-scope job ids return 404 (non-disclosure, not 403).
 *   - Expired jobs return 410 EXPORT_EXPIRED — no download URL issued.
 *   - Live orgScopeIds from PrincipalContext are always injected; the stored
 *     definition's org scope is never used at execution time.
 */

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  NotFoundException,
  GoneException,
  UsePipes,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { getPrincipalContext } from '../../../observability/request-context';
import { ExportRequestService, type ExportRequestResult } from '../application/export-request.service';
import { ExportJobsRepository } from '../application/export-jobs.repository';
import { PresignedUrlService } from '../application/presigned-url.service';
import { CreateExportSchema, type CreateExportDto } from './dto/export-request.dto';
import type { ExportJob } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Response shape for GET /exports/:id
// ---------------------------------------------------------------------------

interface ExportStatusResponse {
  id:           string;
  status:       string;
  format:       string;
  rowCount:     number | null;
  byteSize:     number | null;
  truncated:    boolean;
  createdAt:    string;
  completedAt:  string | null;
  expiresAt:    string | null;
  downloadUrl?: string;
  errorCode?:   string;
}

@Controller('exports')
export class ExportsController {
  constructor(
    private readonly exportService:  ExportRequestService,
    private readonly jobsRepo:       ExportJobsRepository,
    private readonly presignedSvc:   PresignedUrlService,
  ) {}

  // --------------------------------------------------------------------------
  // POST /exports — create export job (Lead only)
  // --------------------------------------------------------------------------

  @Post()
  @HttpCode(202)
  @RequirePermission('report:manage')
  @UsePipes(new ZodValidationPipe(CreateExportSchema))
  async create(
    @Body() dto: CreateExportDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ExportRequestResult> {
    const ctx = getPrincipalContext();
    const result = await this.exportService.requestExport(
      {
        tenantId:        ctx.tenantId,
        userId:          ctx.userId,
        roles:           ctx.roles,
        orgScopeIds:     ctx.orgScopeIds,
      },
      dto,
    );

    // Set Location header so clients can poll without constructing the URL.
    res.setHeader('Location', `/api/v1${result.pollUrl}`);
    return result;
  }

  // --------------------------------------------------------------------------
  // GET /exports/:id — poll status and get presigned download URL
  // --------------------------------------------------------------------------

  @Get(':id')
  @RequirePermission('report:read', 'report:manage')
  async getStatus(@Param('id') id: string): Promise<ExportStatusResponse> {
    const ctx = getPrincipalContext();

    const job: ExportJob | null = await this.jobsRepo.findById(ctx.tenantId, id);
    if (!job) {
      throw new NotFoundException({
        error: { code: 'EXPORT_NOT_FOUND', message: 'Export job not found.' },
      });
    }

    // Check expiry on job row (even if S3 object still exists).
    const now = new Date();
    if (job.expiresAt && job.expiresAt < now) {
      throw new GoneException({
        error: {
          code:    'EXPORT_EXPIRED',
          message: 'This export has expired. Please request a new export.',
        },
      });
    }

    // Mint presigned URL on demand — only for completed, non-expired jobs with an S3 key.
    let downloadUrl: string | undefined;
    if (job.status === 'completed' && job.s3Key) {
      downloadUrl = await this.presignedSvc.getPresignedUrl(
        job.s3Key,
        job.id,
        ctx.tenantId,
      );
    }

    return {
      id:          job.id,
      status:      job.status,
      format:      job.format,
      rowCount:    job.rowCount ?? null,
      byteSize:    job.byteSize ?? null,
      truncated:   job.truncated,
      createdAt:   job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
      expiresAt:   job.expiresAt?.toISOString() ?? null,
      downloadUrl,
      ...(job.errorCode && job.status === 'failed' ? { errorCode: job.errorCode } : {}),
    };
  }
}
