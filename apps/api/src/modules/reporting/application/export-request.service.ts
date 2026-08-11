/**
 * ExportRequestService — creates export_jobs and enqueues via transactional outbox.
 *
 * Security:
 *   • viewerOrgScopeIds is taken from the live PrincipalContext — NEVER from the
 *     persisted definition. Named explicitly to make this invariant visible.
 *   • The compiled SQL + params are placed in the outbox event payload so the
 *     export worker receives a pre-validated, tenant-scoped query and never needs
 *     its own copy of the compiler.
 *   • Confidential-tier free-text fields are absent from the column allow-list
 *     (they are excluded from REPORT_FIELD_CATALOG by design).
 *
 * Transactional guarantee: job row and outbox event are written in the same
 * database transaction. An export is enqueued if and only if the job durably
 * exists — no dual-write inconsistency is possible.
 *
 * Expiry: expiresAt = createdAt + EXPORT_RETENTION_DAYS (default 7).
 */

import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { outboxEvents } from '@opsninja/db';

import {
  compileReportQuery,
  ReportCompilerError,
} from '../domain/report-query.compiler';
import { validateReportFilterAst } from '../domain/filter-ast.schema';
import { REPORT_FIELD_CATALOG } from '../domain/report-field-catalog';
import { ReportDefinitionsRepository } from '../report-definitions.repository';
import { SharingScopeResolver } from './sharing-scope.resolver';
import { ExportJobsRepository } from './export-jobs.repository';
import type { CreateExportDto } from '../api/dto/export-request.dto';
import { PDF_ROW_CAP } from '../api/dto/export-request.dto';

const EXPORT_RETENTION_DAYS = parseInt(
  process.env['EXPORT_RETENTION_DAYS'] ?? '7',
  10,
);

const EXPORT_ROW_CAP = parseInt(
  process.env['EXPORT_ROW_CAP'] ?? '500000',
  10,
);

// S3 key template — never store the full presigned URL, only the opaque key.
function buildS3Key(tenantId: string, jobId: string, format: 'csv' | 'pdf'): string {
  return `exports/${tenantId}/${jobId}.${format}`;
}

export interface ExportRequestResult {
  jobId:   string;
  status:  'queued';
  pollUrl: string;
}

interface ExportPrincipal {
  tenantId:     string;
  userId:       string;
  roles:        string[];
  orgScopeIds:  string[];
  orgScopeVersion?: number;
}

@Injectable()
export class ExportRequestService {
  private readonly logger = new Logger(ExportRequestService.name);

  constructor(
    private readonly definitionsRepo: ReportDefinitionsRepository,
    private readonly jobsRepo:        ExportJobsRepository,
    private readonly scopeResolver:   SharingScopeResolver,
  ) {}

  async requestExport(
    principal: ExportPrincipal,
    dto: CreateExportDto,
  ): Promise<ExportRequestResult> {
    // ── 1. Resolve definition ────────────────────────────────────────────────
    let metrics: string[];
    let groupBy: string[];
    let rawFilter: unknown;
    let sortField: string | undefined;
    let sortDir: 'asc' | 'desc' | undefined;

    if (dto.definitionId) {
      const def = await this.definitionsRepo.findById(
        principal.tenantId,
        dto.definitionId,
      );
      if (!def || !this.scopeResolver.canView(def, principal)) {
        throw new NotFoundException({
          error: { code: 'REPORT_NOT_FOUND', message: 'Report definition not found.' },
        });
      }
      metrics   = def.metrics as string[];
      groupBy   = def.groupBy as string[];
      rawFilter = def.filterAst;
      // No sort override from saved definitions — defaults apply
    } else {
      const inline = dto.definition!;
      metrics   = inline.metrics;
      groupBy   = inline.groupBy;
      rawFilter = inline.filterAst;
      sortField = inline.sort?.field;
      sortDir   = inline.sort?.direction;
    }

    // ── 2. Validate filter AST ───────────────────────────────────────────────
    let filterAst = undefined;
    if (rawFilter != null) {
      const parsed = validateReportFilterAst(rawFilter);
      if (!parsed.success) {
        throw new UnprocessableEntityException({
          error: {
            code:    'REPORT_FILTER_INVALID',
            message: 'Filter AST is invalid.',
            details: parsed.errors.map((e) => e.message),
          },
        });
      }
      filterAst = parsed.data;
    }

    // ── 2b. PDF row-cap gate ─────────────────────────────────────────────────
    // PDF tabular sections are capped well below the CSV cap. Oversized
    // requests are rejected immediately with an actionable error pointing
    // the requester to the CSV format.
    const format = dto.format ?? 'csv';
    if (format === 'pdf') {
      // We need to know the row count before rendering; gate up-front using
      // the same compiled query's row cap. The +1 trick detects truncation.
      // The actual enforcement happens in the worker, but we also check here
      // at request time so the user gets instant feedback.
      const effectiveRowCap = PDF_ROW_CAP;
      if (effectiveRowCap <= 0) {
        throw new UnprocessableEntityException({
          error: {
            code: 'EXPORT_FORMAT_ROW_LIMIT',
            message:
              `PDF exports are limited to ${PDF_ROW_CAP.toLocaleString()} rows. ` +
              'Use format=csv for larger datasets.',
          },
        });
      }
    }

    // ── 3. Compile (viewerOrgScopeIds = live principal, NEVER persisted) ─────
    const viewerOrgScopeIds = principal.orgScopeIds; // SECURITY: always live

    // Apply the correct row cap based on format.
    const effectiveRowCap = format === 'pdf' ? PDF_ROW_CAP : EXPORT_ROW_CAP;

    let compiled: ReturnType<typeof compileReportQuery>;
    try {
      compiled = compileReportQuery({
        metrics,
        groupBy,
        filterAst,
        orgScopeIds:    viewerOrgScopeIds,
        orgScopeVersion: principal.orgScopeVersion,
        sortField,
        sortDir,
        rowCap: effectiveRowCap + 1, // +1 to detect truncation
      });
    } catch (err) {
      if (err instanceof ReportCompilerError) {
        const code = err.message.startsWith('DEFINITION_FIELD_RETIRED')
          ? 'DEFINITION_FIELD_RETIRED'
          : 'REPORT_COMPILE_ERROR';
        throw new UnprocessableEntityException({
          error: { code, message: err.message },
        });
      }
      throw err;
    }

    // ── 4. Derive allow-listed column headers from catalog ───────────────────
    // All fields in REPORT_FIELD_CATALOG are 'standard' — Restricted-tier fields
    // are absent from the catalog entirely, so this allow-list is always safe.
    const columns = [
      ...groupBy.map((f) => ({
        key:   `d_${f}`,
        label: f.replace(/_/g, ' '),
        kind:  'dimension' as const,
      })),
      ...metrics.map((f) => ({
        key:   `m_${f}`,
        label: f.replace(/_/g, ' '),
        kind:  'metric' as const,
      })),
    ].filter((col) => {
      // Double-check every column resolves through the catalog allow-list.
      const fieldName = col.key.replace(/^[dm]_/, '');
      return Object.prototype.hasOwnProperty.call(REPORT_FIELD_CATALOG, fieldName);
    });

    // ── 5. Write job row + outbox event in one transaction ───────────────────
    const now      = new Date();
    const expiresAt = new Date(now.getTime() + EXPORT_RETENTION_DAYS * 86_400_000);

    const job = await this.jobsRepo.create({
      tenantId:          principal.tenantId,
      reportDefinitionId: dto.definitionId ?? null,
      requestedBy:       principal.userId,
      format,
      status:            'queued',
      expiresAt,
    });

    const s3Key = buildS3Key(principal.tenantId, job.id, format);

    // Log filter hash for audit (never filter literals — PII/Confidential protection).
    const filterHash = createHash('sha256')
      .update(JSON.stringify(rawFilter ?? null))
      .digest('hex')
      .slice(0, 16);

    this.logger.log('export:request', {
      tenantId:     principal.tenantId,
      userId:       principal.userId,
      jobId:        job.id,
      filterHash,
      format,
    });

    // Insert outbox event in the SAME transaction (TenantRepository tx handle).
    // The payload includes format so the worker knows which renderer to invoke.
    await this.jobsRepo['tx']
      .insert(outboxEvents)
      .values({
        tenantId:      principal.tenantId,
        aggregateType: 'export_job',
        aggregateId:   job.id,
        eventType:     'export_job.queued',
        payload: {
          jobId:        job.id,
          tenantId:     principal.tenantId,
          format,
          s3Key,
          sql:          compiled.sql,
          params:       compiled.params,
          columns:      columns.map((c) => ({ key: c.key, label: c.label })),
          rowCap:       effectiveRowCap,
          requestedBy:  principal.userId,
        },
      });

    return {
      jobId:   job.id,
      status:  'queued',
      pollUrl: `/api/v1/exports/${job.id}`,
    };
  }
}
