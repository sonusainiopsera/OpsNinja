/**
 * Reporting API types — WO-078.
 *
 * These types mirror the server-side Zod schemas and are the single source
 * of truth for the client–server contract. Generated from OpenAPI in CI;
 * maintained as literals here until the generator is wired up.
 */

// ---------------------------------------------------------------------------
// Field catalog
// ---------------------------------------------------------------------------

export type CatalogDataType =
  | 'text_enum'
  | 'text'
  | 'uuid'
  | 'timestamp'
  | 'date'
  | 'integer'
  | 'numeric';

export type FieldKind = 'dimension' | 'metric';

export interface CatalogFieldEntry {
  name: string;
  label: string;
  dataType: CatalogDataType;
  fieldKind: FieldKind;
  /** Operators permitted for this field. Empty for metrics. */
  allowedOperators: string[];
  /** Enumerated values for text_enum fields */
  enumValues?: string[];
}

export interface FieldCatalogResponse {
  dimensions: CatalogFieldEntry[];
  metrics: CatalogFieldEntry[];
}

// ---------------------------------------------------------------------------
// Filter AST (mirrors server shape — must stay in sync)
// ---------------------------------------------------------------------------

export interface ConditionNode {
  type: 'condition';
  field: string;
  operator: string;
  value: unknown;
}

export interface GroupNode {
  type: 'group';
  op: 'and' | 'or';
  children: FilterNode[];
}

export type FilterNode = ConditionNode | GroupNode;
export type FilterAst = FilterNode | null;

// ---------------------------------------------------------------------------
// Report definitions
// ---------------------------------------------------------------------------

export type ChartType = 'table' | 'bar' | 'line';
export type ReportScope = 'private' | 'team' | 'tenant';

export interface ReportDefinition {
  id: string;
  tenantId: string;
  name: string;
  metrics: string[];
  groupBy: string[];
  chartType: ChartType;
  filterAst: FilterAst;
  scope: ReportScope;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportListResponse {
  data: ReportDefinition[];
}

export interface CreateReportDto {
  name: string;
  metrics: string[];
  groupBy: string[];
  chartType: ChartType;
  filterAst: FilterAst;
  scope: ReportScope;
}

export interface UpdateReportDto extends Partial<CreateReportDto> {}

// ---------------------------------------------------------------------------
// Report run
// ---------------------------------------------------------------------------

export interface RunReportDto {
  definitionId?: string;
  definition?: {
    metrics: string[];
    groupBy: string[];
    filterAst?: FilterAst;
    chartType: ChartType;
    sort?: { field: string; direction: 'asc' | 'desc' };
  };
}

export interface RunResultColumn {
  key: string;
  label: string;
}

export interface RunReportResponse {
  columns: RunResultColumn[];
  rows: Array<Record<string, string | number | null>>;
  rowCount: number;
  truncated: boolean;
  previewCap: number;
  dataAsOf: string;
  replicaLagSeconds: number;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportRequestDto {
  definitionId?: string;
  definition?: {
    metrics: string[];
    groupBy: string[];
    filterAst?: FilterAst;
    sort?: { field: string; direction: 'asc' | 'desc' };
  };
  format: 'csv' | 'pdf';
}

export interface ExportRequestResponse {
  jobId: string;
  status: 'queued';
  pollUrl: string;
}

// ---------------------------------------------------------------------------
// Export job lifecycle (WO-079)
// ---------------------------------------------------------------------------

export type ExportJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired';

export interface ExportJob {
  id: string;
  format: 'csv' | 'pdf';
  status: ExportJobStatus;
  rowCount?: number;
  fileSizeBytes?: number;
  createdAt: string;
  expiresAt?: string;
  /** Only present when status === 'completed' — fetch fresh at download time */
  downloadUrl?: string;
  /** Structured error code when status === 'failed' */
  errorCode?: string;
  traceId?: string;
  definition: {
    metrics: string[];
    groupBy: string[];
    filterAst?: FilterAst;
  };
}

export interface CreateExportPayload {
  format: 'csv' | 'pdf';
  definition?: {
    metrics: string[];
    groupBy: string[];
    filterAst?: FilterAst;
  };
  definitionId?: string;
  scope?: 'report' | 'dashboard';
}

export interface CreateExportResponse {
  jobId: string;
  status: 'queued';
  pollUrl: string;
}

/** Schedule DTO — mirrors the server Zod schema */
export interface ScheduleDto {
  cadence: 'daily' | 'weekly' | 'monthly' | 'custom';
  cronExpression?: string;
  timezone: string;
  format: 'csv' | 'pdf';
  recipients: string[];
  definitionId?: string;
  definition?: {
    metrics: string[];
    groupBy: string[];
    filterAst?: FilterAst;
  };
}

// ---------------------------------------------------------------------------
// API error envelope
// ---------------------------------------------------------------------------

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    traceId?: string;
    details?: unknown;
  };
}

export class ReportingApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly traceId: string | null = null,
  ) {
    super(message);
    this.name = 'ReportingApiError';
  }
}

/** Map API error codes to user-facing copy. */
export const ERROR_COPY: Record<string, string> = {
  REPORT_QUERY_TIMEOUT:
    'The query timed out. Try narrowing the date range or adding more filters.',
  REPORT_ROW_LIMIT_EXCEEDED:
    'Too many results for a preview. Add more filters, or export to CSV for the full dataset.',
  DEFINITION_FIELD_RETIRED:
    'This report uses a field that has been removed from the catalog. Edit the filter to remove it.',
  EXPORT_FORMAT_ROW_LIMIT:
    'PDF exports are limited to 5 000 rows. Use CSV format for larger datasets.',
  REPORT_NOT_FOUND: 'Report definition not found or you do not have permission to view it.',
  REPORT_FILTER_INVALID: 'One or more filters are invalid. Please check your filter values.',
};

export function getErrorCopy(code: string, fallback?: string): string {
  return ERROR_COPY[code] ?? fallback ?? 'An unexpected error occurred. Please try again.';
}
