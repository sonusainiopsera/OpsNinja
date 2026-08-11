/**
 * ReportFieldCatalog
 *
 * Frozen allow-list of dimensions and metrics for the reporting query compiler.
 *
 * Security contract:
 *  - Only catalog-listed identifiers may appear in compiled SQL expressions.
 *  - No user-supplied string is ever placed into an SQL expression; values go
 *    into parameterized placeholders ($N) via the compiler's params array.
 *  - Restricted-tier fields are absent from this catalog entirely so they
 *    cannot be selected, grouped or filtered on.
 *  - Adding a field requires a deliberate catalog entry, not a passthrough.
 */

import { z } from 'zod';

// ── Operator allow-list (reporting subset) ────────────────────────────────────

export const REPORT_OPERATORS = [
  'eq', 'neq', 'in', 'not_in',
  'gt', 'gte', 'lt', 'lte',
  'between',
  'contains',
  'is_null', 'is_not_null',
] as const;

export type ReportOperator = (typeof REPORT_OPERATORS)[number];
export const REPORT_OPERATOR_SET = new Set<string>(REPORT_OPERATORS);

// ── Value schemas ─────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/, 'ISO 8601 date required');
const relativeDateTokens = [
  'today', 'yesterday', 'last_7_days', 'last_30_days', 'last_90_days',
  'last_12_months', 'this_week', 'this_month', 'this_quarter', 'this_year',
] as const;
export type RelativeDateToken = (typeof relativeDateTokens)[number];
const dateValueSchema = z.union([isoDateSchema, z.enum(relativeDateTokens)]);
const dateRangeSchema = z.union([
  z.tuple([dateValueSchema, dateValueSchema]),
  z.enum(relativeDateTokens),
]);

const priorityValues = ['p1', 'p2', 'p3', 'p4'] as const;
const statusValues = ['open', 'in_progress', 'pending', 'resolved', 'closed'] as const;

// ── Classification ────────────────────────────────────────────────────────────

export type FieldClassification = 'public' | 'internal';

// ── Dimension definition ──────────────────────────────────────────────────────

export interface DimensionDef {
  /** SQL expression for GROUP BY clause (may reference table aliases) */
  readonly groupByExpr: string;
  /** SQL expression for WHERE clause filtering */
  readonly filterColumnExpr: string;
  /** Semantic data type used by compiler to select parameterization strategy */
  readonly dataType: 'uuid' | 'text' | 'enum' | 'timestamp';
  /** Exhaustive set of permitted operators for this dimension */
  readonly allowedOperators: readonly ReportOperator[];
  /** Zod schema for filter values; is_null/is_not_null bypass this */
  readonly valueSchema: z.ZodTypeAny;
  /** SQL JOIN aliases required when this dimension is used */
  readonly requiresJoins: readonly string[];
  /** Classification: Restricted fields are absent from catalog */
  readonly classification: FieldClassification;
}

// ── Metric definition ─────────────────────────────────────────────────────────

export interface MetricDef {
  /** SQL aggregate expression for SELECT clause */
  readonly aggregateExpr: string;
  /** Output data type for client rendering decisions */
  readonly dataType: 'integer' | 'numeric' | 'percentage';
  /** SQL JOIN aliases required when this metric is selected */
  readonly requiresJoins: readonly string[];
  /** Classification: Restricted metrics are absent from catalog */
  readonly classification: FieldClassification;
}

// ── Join catalog ──────────────────────────────────────────────────────────────

export const JOIN_CATALOG: Readonly<Record<string, string>> = Object.freeze({
  organizations:
    'LEFT JOIN organizations o ON o.id = t.organization_id AND o.tenant_id = t.tenant_id',
  users:
    'LEFT JOIN users u ON u.id = t.assignee_id AND u.tenant_id = t.tenant_id',
  assignment_groups:
    'LEFT JOIN assignment_groups ag ON ag.id = t.assignment_group_id AND ag.tenant_id = t.tenant_id',
  ticket_affected_areas:
    'LEFT JOIN ticket_affected_areas taa ON taa.ticket_id = t.id AND taa.tenant_id = t.tenant_id',
});

// ── Dimension catalog ─────────────────────────────────────────────────────────

export const DIMENSION_CATALOG: Readonly<Record<string, DimensionDef>> = Object.freeze({
  organization: {
    groupByExpr: "COALESCE(o.name, 'Unassigned')",
    filterColumnExpr: 't.organization_id',
    dataType: 'uuid',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([uuidSchema, z.array(uuidSchema).min(1)]),
    requiresJoins: ['organizations'],
    classification: 'public',
  },

  organization_tier: {
    groupByExpr: "COALESCE(o.tier, 'Unassigned')",
    filterColumnExpr: 'o.tier',
    dataType: 'text',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    requiresJoins: ['organizations'],
    classification: 'public',
  },

  category_path: {
    groupByExpr: "COALESCE(t.category_path, 'Unassigned')",
    filterColumnExpr: 't.category_path',
    dataType: 'text',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'contains', 'is_null', 'is_not_null'],
    valueSchema: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    requiresJoins: [],
    classification: 'public',
  },

  sub_category: {
    groupByExpr: "COALESCE(t.sub_category, 'Unassigned')",
    filterColumnExpr: 't.sub_category',
    dataType: 'text',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'contains', 'is_null', 'is_not_null'],
    valueSchema: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    requiresJoins: [],
    classification: 'public',
  },

  priority: {
    groupByExpr: "COALESCE(t.priority, 'Unassigned')",
    filterColumnExpr: 't.priority',
    dataType: 'enum',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([z.enum(priorityValues), z.array(z.enum(priorityValues)).min(1)]),
    requiresJoins: [],
    classification: 'public',
  },

  status: {
    groupByExpr: 't.status',
    filterColumnExpr: 't.status',
    dataType: 'enum',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([z.enum(statusValues), z.array(z.enum(statusValues)).min(1)]),
    requiresJoins: [],
    classification: 'public',
  },

  assignment_group: {
    groupByExpr: "COALESCE(ag.name, 'Unassigned')",
    filterColumnExpr: 't.assignment_group_id',
    dataType: 'uuid',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([uuidSchema, z.array(uuidSchema).min(1)]),
    requiresJoins: ['assignment_groups'],
    classification: 'public',
  },

  agent: {
    groupByExpr: "COALESCE(u.display_name, 'Unassigned')",
    filterColumnExpr: 't.assignee_id',
    dataType: 'uuid',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([uuidSchema, z.array(uuidSchema).min(1)]),
    requiresJoins: ['users'],
    classification: 'public',
  },

  ai_affected_area: {
    groupByExpr: "COALESCE(taa.area, 'Unassigned')",
    filterColumnExpr: 'taa.area',
    dataType: 'text',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    valueSchema: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    requiresJoins: ['ticket_affected_areas'],
    classification: 'public',
  },

  created_date: {
    groupByExpr: "DATE_TRUNC('day', t.created_at)::date",
    filterColumnExpr: 't.created_at',
    dataType: 'timestamp',
    allowedOperators: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
    valueSchema: z.union([dateValueSchema, dateRangeSchema]),
    requiresJoins: [],
    classification: 'public',
  },

  resolved_date: {
    groupByExpr: "DATE_TRUNC('day', t.resolved_at)::date",
    filterColumnExpr: 't.resolved_at',
    dataType: 'timestamp',
    allowedOperators: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
    valueSchema: z.union([dateValueSchema, dateRangeSchema]),
    requiresJoins: [],
    classification: 'public',
  },
} as const);

// ── Metric catalog ────────────────────────────────────────────────────────────

export const METRIC_CATALOG: Readonly<Record<string, MetricDef>> = Object.freeze({
  ticket_count: {
    aggregateExpr: 'COUNT(*)',
    dataType: 'integer',
    requiresJoins: [],
    classification: 'public',
  },

  avg_resolution_minutes: {
    aggregateExpr:
      'ROUND(AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 60.0)::numeric, 2)',
    dataType: 'numeric',
    requiresJoins: [],
    classification: 'public',
  },

  median_resolution_minutes: {
    aggregateExpr:
      'ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 60.0)::numeric, 2)',
    dataType: 'numeric',
    requiresJoins: [],
    classification: 'public',
  },

  p90_resolution_minutes: {
    aggregateExpr:
      'ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 60.0)::numeric, 2)',
    dataType: 'numeric',
    requiresJoins: [],
    classification: 'public',
  },

  sla_attainment_pct: {
    aggregateExpr:
      "ROUND(100.0 * SUM(CASE WHEN t.sla_state != 'breached' THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0), 2)",
    dataType: 'percentage',
    requiresJoins: [],
    classification: 'public',
  },

  sla_breach_count: {
    aggregateExpr:
      "SUM(CASE WHEN t.sla_state = 'breached' THEN 1 ELSE 0 END)",
    dataType: 'integer',
    requiresJoins: [],
    classification: 'public',
  },

  avg_first_response_minutes: {
    aggregateExpr:
      'ROUND(AVG(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 60.0)::numeric, 2)',
    dataType: 'numeric',
    requiresJoins: [],
    classification: 'public',
  },

  csat_avg: {
    aggregateExpr: 'ROUND(AVG(t.csat_score)::numeric, 2)',
    dataType: 'numeric',
    requiresJoins: [],
    classification: 'public',
  },
} as const);

// ── Lookup helpers ────────────────────────────────────────────────────────────

export function getDimensionDef(name: string): DimensionDef | undefined {
  return DIMENSION_CATALOG[name];
}

export function getMetricDef(name: string): MetricDef | undefined {
  return METRIC_CATALOG[name];
}

export function isKnownDimension(name: string): boolean {
  return name in DIMENSION_CATALOG;
}

export function isKnownMetric(name: string): boolean {
  return name in METRIC_CATALOG;
}

export const ALL_DIMENSION_NAMES = Object.freeze(Object.keys(DIMENSION_CATALOG));
export const ALL_METRIC_NAMES = Object.freeze(Object.keys(METRIC_CATALOG));
