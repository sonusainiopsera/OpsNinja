/**
 * ReportQueryCompiler
 *
 * Builds a fully parameterized aggregate SQL statement from a validated report
 * definition. Every identifier is resolved through the frozen DIMENSION_CATALOG
 * and METRIC_CATALOG so only allow-listed SQL expressions can appear in the
 * generated query.
 *
 * Security invariants:
 *  - No user-supplied string is concatenated into the SQL text.
 *  - The tenant predicate is unconditionally appended to every query.
 *  - The org-scope predicate is appended whenever orgScopeIds is non-null.
 *  - Values appear only in the params array bound by the driver ($1, $2, ...).
 *  - Internal invariant violations throw and log the signature, never the SQL.
 */

import { createHash } from 'node:crypto';
import {
  compileToPredicate,
  type FilterAst,
} from '@opsninja/filter-compiler';
import {
  getDimensionDef,
  getMetricDef,
  isKnownDimension,
  isKnownMetric,
  JOIN_CATALOG,
  type DimensionDef,
  type MetricDef,
} from './report-field-catalog';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Server-side row cap injected as LIMIT */
export const REPORT_ROW_CAP = 10_000;

/** Compiler version — increment to invalidate all cached compiled forms */
export const REPORT_COMPILER_VERSION = 1;

/** Max date range months before a warning is flagged (not a hard cap) */
export const DATE_RANGE_WARN_MONTHS = 12;

// ── Error codes ───────────────────────────────────────────────────────────────

export const ReportCompileErrorCode = {
  UNKNOWN_METRIC: 'UNKNOWN_METRIC',
  UNKNOWN_DIMENSION: 'UNKNOWN_DIMENSION',
  METRIC_DIMENSION_INCOMPATIBLE: 'REPORT_METRIC_DIMENSION_INCOMPATIBLE',
  DEFINITION_FIELD_RETIRED: 'DEFINITION_FIELD_RETIRED',
  ROW_CAP_OVERFLOW: 'ROW_CAP_OVERFLOW',
} as const;

export class ReportCompileError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ReportCompileError';
  }
}

// ── Input / output types ──────────────────────────────────────────────────────

export interface ReportQueryInput {
  /** Allow-listed metric keys from METRIC_CATALOG */
  metrics: string[];
  /** Allow-listed dimension keys from DIMENSION_CATALOG for GROUP BY */
  groupBy: string[];
  /** Validated filter AST (may be undefined for no filter) */
  filterAst?: FilterAst | null;
  /** Tenant UUID — always appended as WHERE predicate */
  tenantId: string;
  /**
   * Viewer org scope UUIDs.
   * undefined = tenant-wide role (no org restriction).
   * string[]   = scoped role; empty array yields zero rows (no visible orgs).
   */
  orgScopeIds?: string[];
  /** Org-scope version from principal JWT — included in cache key */
  orgScopeVersion?: number;
  /** Allow-listed sort field (metric or dimension name) */
  sortField?: string;
  /** Sort order — defaults to 'desc' */
  sortOrder?: 'asc' | 'desc';
  /** Override the row cap for testing */
  rowCapOverride?: number;
}

export interface CompiledQuery {
  /** Parameterized SQL text — no user literals */
  sql: string;
  /** Positional parameter values aligned to $1..$N in sql */
  params: unknown[];
  /** Deterministic cache key for this definition + org scope version */
  signature: string;
  /** Metadata for observability */
  meta: {
    metricsCount: number;
    dimensionsCount: number;
    filterConditions: number;
    rowCap: number;
  };
}

// ── Compiler ──────────────────────────────────────────────────────────────────

/**
 * Compiles a report definition into a parameterized aggregate SQL query.
 *
 * Throws ReportCompileError for invalid metric/dimension names.
 * Throws generic Error for internal invariant violations (logged, not leaked).
 */
export function compileReportQuery(input: ReportQueryInput): CompiledQuery {
  const { metrics, groupBy, filterAst, tenantId, orgScopeIds, sortField, sortOrder } = input;
  const rowCap = input.rowCapOverride ?? REPORT_ROW_CAP;

  // ── Resolve catalog entries ───────────────────────────────────────────────

  const resolvedMetrics = metrics.map(m => {
    const def = getMetricDef(m);
    if (!def) {
      throw new ReportCompileError(
        ReportCompileErrorCode.UNKNOWN_METRIC,
        `Metric "${m}" is not in the reporting catalog. Possible cause: field was retired.`,
        { field: m },
      );
    }
    return { name: m, def };
  });

  const resolvedDimensions = groupBy.map(d => {
    const def = getDimensionDef(d);
    if (!def) {
      throw new ReportCompileError(
        ReportCompileErrorCode.UNKNOWN_DIMENSION,
        `Dimension "${d}" is not in the reporting catalog. Possible cause: field was retired.`,
        { field: d },
      );
    }
    return { name: d, def };
  });

  // ── Collect required JOINs ────────────────────────────────────────────────

  const joinKeys = new Set<string>();
  for (const { def } of resolvedDimensions) {
    for (const j of def.requiresJoins) joinKeys.add(j);
  }
  for (const { def } of resolvedMetrics) {
    for (const j of def.requiresJoins) joinKeys.add(j);
  }

  const joinClauses = [...joinKeys]
    .map(k => JOIN_CATALOG[k])
    .filter((j): j is string => !!j);

  // ── Build parameter list ──────────────────────────────────────────────────

  const params: unknown[] = [];
  function push(val: unknown): string {
    params.push(val);
    return `$${params.length}`;
  }

  // ── Build SELECT clause ───────────────────────────────────────────────────

  const selectParts: string[] = [];

  // Dimension columns first (for GROUP BY ordinals)
  for (const { name, def } of resolvedDimensions) {
    selectParts.push(`${def.groupByExpr} AS "${name}"`);
  }

  // Metric aggregates
  for (const { name, def } of resolvedMetrics) {
    selectParts.push(`${def.aggregateExpr} AS "${name}"`);
  }

  if (selectParts.length === 0) {
    selectParts.push('COUNT(*) AS "ticket_count"');
  }

  // ── Build FROM + JOIN clause ──────────────────────────────────────────────

  const fromClause =
    joinClauses.length > 0
      ? `tickets t\n  ${joinClauses.join('\n  ')}`
      : 'tickets t';

  // ── Build WHERE clause ────────────────────────────────────────────────────

  const whereParts: string[] = [];

  // Unconditional tenant predicate
  const tenantPlaceholder = push(tenantId);
  whereParts.push(`t.tenant_id = ${tenantPlaceholder}`);

  // Org-scope predicate (scoped roles only; undefined = tenant-wide)
  if (orgScopeIds !== undefined) {
    if (orgScopeIds.length === 0) {
      // No orgs in scope → zero rows (sentinel FALSE without disclosing anything)
      whereParts.push('FALSE');
    } else {
      const orgPlaceholder = push(orgScopeIds);
      whereParts.push(`t.organization_id = ANY(${orgPlaceholder})`);
    }
  }

  // User-defined filter predicates
  let filterConditionCount = 0;
  if (filterAst) {
    const predicate = compileToPredicate(filterAst);
    const offset = params.length; // shift $1→$(offset+1), $2→$(offset+2), ...
    // Merge filter params into our params array
    for (const p of predicate.params) params.push(p);
    // Re-number $N placeholders to account for tenant/scope params already pushed
    const shiftedSql = offset === 0
      ? predicate.sql
      : predicate.sql.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n, 10) + offset}`);
    whereParts.push(shiftedSql);
    filterConditionCount = countFilterConditions(filterAst);
  }

  // ── Build GROUP BY clause ─────────────────────────────────────────────────

  const groupByOrdinals = resolvedDimensions.map((_, i) => String(i + 1));

  // ── Build ORDER BY clause ─────────────────────────────────────────────────

  let orderByClause = '';
  if (sortField) {
    // Validate sort field is in our SELECT aliases
    const validSortFields = [
      ...resolvedDimensions.map(d => d.name),
      ...resolvedMetrics.map(m => m.name),
    ];
    if (!validSortFields.includes(sortField)) {
      throw new ReportCompileError(
        ReportCompileErrorCode.UNKNOWN_METRIC,
        `Sort field "${sortField}" is not in the selected metrics or dimensions.`,
        { field: sortField },
      );
    }
    const dir = sortOrder === 'asc' ? 'ASC' : 'DESC';
    // Use quoted alias — safe because sortField is catalog-validated
    orderByClause = `ORDER BY "${sortField}" ${dir}`;
  } else if (resolvedMetrics.length > 0) {
    // Default: sort by first metric descending
    const firstMetric = resolvedMetrics[0]!.name;
    orderByClause = `ORDER BY "${firstMetric}" DESC`;
  }

  // ── Build LIMIT clause ────────────────────────────────────────────────────

  const limitPlaceholder = push(rowCap + 1);

  // ── Assemble final SQL ────────────────────────────────────────────────────

  const selectStr = selectParts.join(',\n  ');
  const whereStr = whereParts.join('\n  AND ');
  const groupByStr = groupByOrdinals.length > 0 ? `GROUP BY ${groupByOrdinals.join(', ')}` : '';

  const sql = [
    `SELECT`,
    `  ${selectStr}`,
    `FROM ${fromClause}`,
    `WHERE`,
    `  ${whereStr}`,
    groupByStr,
    orderByClause,
    `LIMIT ${limitPlaceholder}`,
  ]
    .filter(Boolean)
    .join('\n');

  // ── Compute signature ─────────────────────────────────────────────────────

  const signature = computeQuerySignature(input);

  return {
    sql,
    params,
    signature,
    meta: {
      metricsCount: resolvedMetrics.length,
      dimensionsCount: resolvedDimensions.length,
      filterConditions: filterConditionCount,
      rowCap,
    },
  };
}

// ── Signature / caching ───────────────────────────────────────────────────────

/**
 * Computes a deterministic SHA-256 cache key for a report query input.
 *
 * Includes:
 *  - compiler version (bumping invalidates all cached forms)
 *  - metrics, groupBy, filterAst (canonical JSON, sorted keys)
 *  - orgScopeVersion (bumping invalidates stale-scope cached forms)
 *
 * Excludes tenantId and orgScopeIds (they vary per principal, not per
 * definition; adding them would prevent any cross-session reuse of compiled
 * forms for the same definition).
 */
export function computeQuerySignature(input: Omit<ReportQueryInput, 'tenantId' | 'orgScopeIds'>): string {
  const canonical = {
    v: REPORT_COMPILER_VERSION,
    metrics: [...input.metrics].sort(),
    groupBy: [...input.groupBy].sort(),
    filterAst: input.filterAst ?? null,
    orgScopeVersion: input.orgScopeVersion ?? 0,
    sortField: input.sortField ?? null,
    sortOrder: input.sortOrder ?? 'desc',
  };
  const json = JSON.stringify(sortKeys(canonical));
  const hash = createHash('sha256').update(json, 'utf8').digest('hex');
  return `reporting:v${REPORT_COMPILER_VERSION}:${hash}`;
}

/** Returns Redis cache key for a compiled query signature */
export function reportingCacheKey(signature: string): string {
  return signature;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

function countFilterConditions(ast: FilterAst | null | undefined): number {
  if (!ast) return 0;
  if (ast.type === 'condition') return 1;
  return ast.children.reduce((n: number, c: FilterAst) => n + countFilterConditions(c), 0);
}

// ── Defensive re-validation at execution time ─────────────────────────────────

/**
 * Validates that all metrics and dimensions referenced by a stored definition
 * still exist in the current catalog. Returns an error if any field was retired.
 *
 * Must be called at execution time (not just at write time) because a definition
 * could have been saved before a catalog field was removed.
 */
export function validateDefinitionAgainstCurrentCatalog(
  metrics: string[],
  groupBy: string[],
): { ok: true } | { ok: false; code: string; message: string; retiredFields: string[] } {
  const retiredFields: string[] = [];

  for (const m of metrics) {
    if (!isKnownMetric(m)) retiredFields.push(`metric:${m}`);
  }
  for (const d of groupBy) {
    if (!isKnownDimension(d)) retiredFields.push(`dimension:${d}`);
  }

  if (retiredFields.length > 0) {
    return {
      ok: false,
      code: 'DEFINITION_FIELD_RETIRED',
      message: `Definition references catalog fields that no longer exist: ${retiredFields.join(', ')}`,
      retiredFields,
    };
  }
  return { ok: true };
}

// Re-export catalog lookups for convenience
export { isKnownMetric, isKnownDimension, getDimensionDef, getMetricDef } from './report-field-catalog';
