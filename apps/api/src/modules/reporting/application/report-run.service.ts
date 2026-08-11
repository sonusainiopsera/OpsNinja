/**
 * ReportRunService — synchronous preview execution.
 *
 * Security:
 *  - viewerOrgScopeIds is always taken from the live PrincipalContext —
 *    NEVER from the persisted definition. Named explicitly to make this
 *    invariant visible in code review.
 *  - Preview cap (default 5 000 rows) is enforced before returning.
 *  - dataAsOf and stale flag come from the ReplicaLagProbe.
 */

import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  GatewayTimeoutException,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';

import {
  compileReportQuery,
  ReportCompilerError,
} from '../domain/report-query.compiler';
import { validateReportFilterAst } from '../domain/filter-ast.schema';
import {
  TenantScopedReplicaRunner,
} from '../infrastructure/tenant-scoped-replica.runner';
import {
  ReplicaLagProbe,
  DEFAULT_LAG_THRESHOLD_SECONDS,
} from '../infrastructure/replica-lag.probe';
import {
  StatementTimeoutError,
  ReplicaUnavailableError,
} from '../infrastructure/reporting-errors';
import { ReportDefinitionsRepository } from '../report-definitions.repository';
import { SharingScopeResolver } from './sharing-scope.resolver';
import type { RunReportDto } from '../api/dto/run-report.dto';
import type { ReportDefinition } from '@opsninja/db';

const PREVIEW_ROW_LIMIT = parseInt(
  process.env['REPORT_PREVIEW_ROW_LIMIT'] ?? '5000',
  10,
);
const STALE_LAG_SECONDS = parseInt(
  process.env['REPORTING_STALE_LAG_SECONDS'] ?? String(DEFAULT_LAG_THRESHOLD_SECONDS),
  10,
);

export interface RunReportResult {
  columns:    Array<{ key: string; label: string; type: string }>;
  rows:       Record<string, unknown>[];
  totals:     Record<string, unknown>;
  rowCount:   number;
  truncated:  boolean;
  chartType:  string;
  dataAsOf:   string;
  stale:      boolean;
  traceId:    string;
}

interface ViewerPrincipal {
  tenantId:       string;
  userId:         string;
  roles:          string[];
  orgScopeIds:    string[];
  orgScopeVersion?: number;
  traceId:        string;
}

@Injectable()
export class ReportRunService {
  private readonly logger = new Logger(ReportRunService.name);

  constructor(
    private readonly repo:           ReportDefinitionsRepository,
    private readonly runner:         TenantScopedReplicaRunner,
    private readonly lagProbe:       ReplicaLagProbe,
    private readonly scopeResolver:  SharingScopeResolver,
  ) {}

  async run(
    principal: ViewerPrincipal,
    dto: RunReportDto,
  ): Promise<RunReportResult> {
    // ── 1. Resolve definition (saved or inline) ───────────────────────────
    let definition: ReportDefinition | null = null;

    if (dto.definitionId) {
      definition = await this.repo.findById(principal.tenantId, dto.definitionId);
      if (!definition) {
        throw new NotFoundException({
          error: { code: 'REPORT_NOT_FOUND', message: 'Report definition not found.' },
        });
      }
      if (!this.scopeResolver.canView(definition, principal)) {
        // Return 404 — do not disclose existence.
        throw new NotFoundException({
          error: { code: 'REPORT_NOT_FOUND', message: 'Report definition not found.' },
        });
      }
    }

    // ── 2. Resolve compile inputs (viewer scope always from live principal) ──
    const inline = dto.definition;
    const metrics   = inline ? inline.metrics   : (definition!.metrics  as string[]);
    const groupBy   = inline ? inline.groupBy   : (definition!.groupBy  as string[]);
    const rawFilter = inline ? inline.filterAst : definition!.filterAst;
    const chartType = inline ? inline.chartType : (definition!.chartType ?? 'table');
    const sortField = inline?.sort?.field;
    const sortDir   = inline?.sort?.direction;

    // Validate filter AST
    let filterAst = undefined;
    if (rawFilter != null) {
      const parsed = validateReportFilterAst(rawFilter);
      if (!parsed.success) {
        throw new UnprocessableEntityException({
          error: {
            code: 'REPORT_FILTER_INVALID',
            message: 'Filter AST is invalid.',
            details: parsed.errors.map((e) => e.message),
          },
        });
      }
      filterAst = parsed.data;
    }

    // ── 3. Compile (viewerOrgScopeIds = live principal, never persisted) ────
    const viewerOrgScopeIds = principal.orgScopeIds;

    let compiled: ReturnType<typeof compileReportQuery>;
    try {
      compiled = compileReportQuery({
        metrics,
        groupBy,
        filterAst,
        orgScopeIds:    viewerOrgScopeIds,  // ALWAYS the live caller scope
        orgScopeVersion: principal.orgScopeVersion,
        sortField,
        sortDir,
        rowCap:         PREVIEW_ROW_LIMIT + 1,  // +1 to detect truncation
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

    // Log access with filter hash (never filter literals — PII/Confidential protection).
    const filterHash = createHash('sha256')
      .update(JSON.stringify(rawFilter ?? null))
      .digest('hex')
      .slice(0, 16);
    this.logger.log('report:run', {
      tenantId:     principal.tenantId,
      userId:       principal.userId,
      definitionId: dto.definitionId ?? null,
      filterHash,
      traceId:      principal.traceId,
    });

    // ── 4. Execute on replica ────────────────────────────────────────────────
    let rawRows: Record<string, unknown>[];
    try {
      rawRows = await this.runner.run(async (client: PoolClient) => {
        const result = await client.query<Record<string, unknown>>(
          compiled.sql,
          compiled.params as unknown[],
        );
        return result.rows;
      });
    } catch (err) {
      if (err instanceof StatementTimeoutError) {
        throw new GatewayTimeoutException({
          error: {
            code:    'REPORT_QUERY_TIMEOUT',
            message: 'Report query exceeded the 30-second time limit. Try a narrower date range.',
          },
        });
      }
      if (err instanceof ReplicaUnavailableError) {
        throw new GatewayTimeoutException({
          error: {
            code:    'REPORTING_REPLICA_UNAVAILABLE',
            message: 'Reporting replica is temporarily unavailable. Please retry.',
          },
        });
      }
      throw err;
    }

    // ── 5. Apply preview cap ─────────────────────────────────────────────────
    const truncated  = rawRows.length > PREVIEW_ROW_LIMIT;
    const rows       = truncated ? rawRows.slice(0, PREVIEW_ROW_LIMIT) : rawRows;
    const rowCount   = rows.length;

    // ── 6. Derive columns from first row ──────────────────────────────────────
    const columns = buildColumns(rows[0] ?? {});

    // ── 7. Compute totals (sum numeric metric columns) ────────────────────────
    const totals = computeTotals(rows, columns);

    // ── 8. Freshness ─────────────────────────────────────────────────────────
    const freshness = this.lagProbe.getReplicaFreshness();
    const stale     = freshness.lagSeconds > STALE_LAG_SECONDS || freshness.probeError !== null;
    const dataAsOf  = freshness.lastProbedAt
      ? new Date(Date.now() - freshness.lagSeconds * 1000).toISOString()
      : new Date().toISOString();

    return {
      columns,
      rows,
      totals,
      rowCount,
      truncated,
      chartType: String(chartType),
      dataAsOf,
      stale,
      traceId: principal.traceId,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildColumns(sampleRow: Record<string, unknown>): Array<{ key: string; label: string; type: string }> {
  return Object.keys(sampleRow).map((key) => ({
    key,
    label: key.replace(/^(d|m)_/, '').replace(/_/g, ' '),
    type:  typeof sampleRow[key] === 'number' ? 'number' : 'string',
  }));
}

function computeTotals(
  rows: Record<string, unknown>[],
  columns: Array<{ key: string; type: string }>,
): Record<string, unknown> {
  const totals: Record<string, unknown> = {};
  for (const col of columns) {
    if (col.type === 'number') {
      totals[col.key] = rows.reduce((acc, row) => acc + (Number(row[col.key]) || 0), 0);
    }
  }
  return totals;
}
