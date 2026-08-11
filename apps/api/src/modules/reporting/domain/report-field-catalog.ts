/**
 * ReportFieldCatalog — frozen allow-list of dimensions and metrics.
 *
 * Security guarantee: the compiler resolves EVERY identifier through this
 * catalog. Unknown field names, unknown operators, and type-mismatched values
 * are rejected at validation time and can never reach compile().
 *
 * Classification rules:
 *   - 'standard': field is included in the catalog and can be queried.
 *   - Restricted-tier fields are deliberately absent from this catalog.
 *
 * fieldKind:
 *   - 'dimension': used in GROUP BY and can appear in filter conditions.
 *   - 'metric': aggregate expression for SELECT only; cannot be filtered.
 *
 * requiresJoin: the SQL alias injected into the FROM clause when a field
 *   referencing an external table is selected or grouped by.
 *
 * nullable: when true, the compiler wraps GROUP BY expressions in
 *   COALESCE(..., 'Unassigned') so NULL-valued rows are bucketed explicitly.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
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
export type RequiredJoin = 'organizations' | 'ticket_sla';

export interface CatalogFieldEntry {
  /** SQL expression used in WHERE predicates (raw, no COALESCE). */
  sqlExpression: string;
  dataType: CatalogDataType;
  /** Operators permitted for filter conditions. Empty for metrics (not filterable). */
  allowedOperators: ReadonlyArray<string>;
  /** When set, this JOIN alias must be added to the FROM clause. */
  requiresJoin?: RequiredJoin;
  /** All catalog entries are 'standard'; restricted fields are absent. */
  classification: 'standard';
  /** Determines whether the field may be grouped or only used as an aggregate. */
  fieldKind: FieldKind;
  /** When true, GROUP BY wraps the expression in COALESCE(..., 'Unassigned'). */
  nullable?: boolean;
  /** Zod value schema for scalar filter conditions. Required for filterable dimensions. */
  scalarValueSchema?: z.ZodTypeAny;
  /** Zod schema for array values (in / not_in). Defaults to array of scalarValueSchema. */
  arrayValueSchema?: z.ZodTypeAny;
  /** Zod schema for between range: [lower, upper]. */
  rangeValueSchema?: z.ZodTypeAny;
}

export type ReportCatalog = Readonly<Record<string, CatalogFieldEntry>>;

// ---------------------------------------------------------------------------
// Value schemas (reusable across catalog entries)
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid({ message: 'Must be a valid UUID' });
const uuidArraySchema = z.array(uuidSchema).min(1);

const iso8601Schema = z.string().refine(
  (v) => {
    const d = new Date(v);
    return !isNaN(d.getTime());
  },
  { message: 'Must be an ISO-8601 date string' },
);
const iso8601RangeSchema = z.array(iso8601Schema).length(2, {
  message: 'between requires exactly two ISO-8601 date values [from, to]',
});

const PRIORITY_VALUES = ['P1', 'P2', 'P3', 'P4'] as const;
const STATUS_VALUES = ['open', 'in_progress', 'pending', 'resolved', 'closed'] as const;
const ORG_TIER_VALUES = ['standard', 'premium', 'enterprise'] as const;

const priorityEnum = z.enum(PRIORITY_VALUES);
const statusEnum = z.enum(STATUS_VALUES);
const orgTierEnum = z.enum(ORG_TIER_VALUES);

// ---------------------------------------------------------------------------
// Report field catalog
// ---------------------------------------------------------------------------

export const REPORT_FIELD_CATALOG: ReportCatalog = Object.freeze({

  // ── Dimensions ────────────────────────────────────────────────────────────

  organization: {
    sqlExpression: '"t"."organization_id"',
    dataType: 'uuid',
    allowedOperators: ['eq', 'neq', 'in', 'not_in'],
    classification: 'standard',
    fieldKind: 'dimension',
    nullable: false,
    scalarValueSchema: uuidSchema,
    arrayValueSchema: uuidArraySchema,
  },

  organization_tier: {
    sqlExpression: '"o"."tier"',
    dataType: 'text_enum',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    requiresJoin: 'organizations',
    classification: 'standard',
    fieldKind: 'dimension',
    nullable: true,
    scalarValueSchema: orgTierEnum,
    arrayValueSchema: z.array(orgTierEnum).min(1),
  },

  category_path: {
    sqlExpression: '"t"."category_path"',
    dataType: 'text',
    allowedOperators: ['eq', 'neq', 'contains', 'is_null', 'is_not_null'],
    classification: 'standard',
    fieldKind: 'dimension',
    nullable: true,
    scalarValueSchema: z.string().min(1).max(512),
  },

  sub_category: {
    sqlExpression: '"t"."sub_category"',
    dataType: 'text',
    allowedOperators: ['eq', 'neq', 'contains', 'is_null', 'is_not_null'],
    classification: 'standard',
    fieldKind: 'dimension',
    nullable: true,
    scalarValueSchema: z.string().min(1).max(512),
  },

  priority: {
    sqlExpression: '"t"."priority"',
    dataType: 'text_enum',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    classification: 'standard',
    fieldKind: 'dimension',
    nullable: true,
    scalarValueSchema: priorityEnum,
    arrayValueSchema: z.array(priorityEnum).min(1),
  },

  status: {
    sqlExpression: '"t"."status"',
    dataType: 'text_enum',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    classification: 'standard',
    fieldKind: 'dimension',
    nullable: true,
    scalarValueSchema: statusEnum,
    arrayValueSchema: z.array(statusEnum).min(1),
  },

  assignment_group: {
    sqlExpression: '"t"."assignment_group_id"',
    dataType: 'uuid',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    classification: 'standard',
    fieldKind: 'dimension',
    nullable: true,
    scalarValueSchema: uuidSchema,
    arrayValueSchema: uuidArraySchema,
  },

  agent: {
    sqlExpression: '"t"."assignee_id"',
    dataType: 'uuid',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    classification: 'standard',
    fieldKind: 'dimension',
    nullable: true,
    scalarValueSchema: uuidSchema,
    arrayValueSchema: uuidArraySchema,
  },

  ai_affected_area: {
    sqlExpression: '"t"."ai_affected_area_tag"',
    dataType: 'text',
    allowedOperators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
    classification: 'standard',
    fieldKind: 'dimension',
    nullable: true,
    scalarValueSchema: z.string().min(1).max(256),
    arrayValueSchema: z.array(z.string().min(1).max(256)).min(1),
  },

  created_date: {
    sqlExpression: 'DATE("t"."created_at")',
    dataType: 'date',
    allowedOperators: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'],
    classification: 'standard',
    fieldKind: 'dimension',
    nullable: false,
    scalarValueSchema: iso8601Schema,
    rangeValueSchema: iso8601RangeSchema,
  },

  resolved_date: {
    sqlExpression: 'DATE("t"."resolved_at")',
    dataType: 'date',
    allowedOperators: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
    classification: 'standard',
    fieldKind: 'dimension',
    nullable: true,
    scalarValueSchema: iso8601Schema,
    rangeValueSchema: iso8601RangeSchema,
  },

  // ── Metrics ───────────────────────────────────────────────────────────────

  ticket_count: {
    sqlExpression: 'COUNT(*)',
    dataType: 'integer',
    allowedOperators: [],
    classification: 'standard',
    fieldKind: 'metric',
  },

  avg_resolution_minutes: {
    sqlExpression:
      'ROUND(AVG(EXTRACT(EPOCH FROM ("t"."resolved_at" - "t"."created_at")) / 60)::numeric, 2)',
    dataType: 'numeric',
    allowedOperators: [],
    classification: 'standard',
    fieldKind: 'metric',
  },

  median_resolution_minutes: {
    sqlExpression:
      'ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("t"."resolved_at" - "t"."created_at")) / 60)::numeric, 2)',
    dataType: 'numeric',
    allowedOperators: [],
    classification: 'standard',
    fieldKind: 'metric',
  },

  p90_resolution_minutes: {
    sqlExpression:
      'ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("t"."resolved_at" - "t"."created_at")) / 60)::numeric, 2)',
    dataType: 'numeric',
    allowedOperators: [],
    classification: 'standard',
    fieldKind: 'metric',
  },

  sla_attainment_pct: {
    sqlExpression:
      "ROUND((COUNT(*) FILTER (WHERE \"t\".\"sla_state\" != 'breached') * 100.0 / NULLIF(COUNT(*), 0))::numeric, 2)",
    dataType: 'numeric',
    allowedOperators: [],
    classification: 'standard',
    fieldKind: 'metric',
  },

  sla_breach_count: {
    sqlExpression: "COUNT(*) FILTER (WHERE \"t\".\"sla_state\" = 'breached')",
    dataType: 'integer',
    allowedOperators: [],
    classification: 'standard',
    fieldKind: 'metric',
  },

  avg_first_response_minutes: {
    sqlExpression:
      'ROUND(AVG(EXTRACT(EPOCH FROM ("ts"."first_response_at" - "t"."created_at")) / 60)::numeric, 2)',
    dataType: 'numeric',
    allowedOperators: [],
    requiresJoin: 'ticket_sla',
    classification: 'standard',
    fieldKind: 'metric',
  },

  csat_avg: {
    sqlExpression: 'ROUND(AVG("t"."csat_score")::numeric, 2)',
    dataType: 'numeric',
    allowedOperators: [],
    classification: 'standard',
    fieldKind: 'metric',
  },

} satisfies ReportCatalog);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type ReportFieldName = keyof typeof REPORT_FIELD_CATALOG;

export function isKnownReportField(field: string): field is ReportFieldName {
  return Object.prototype.hasOwnProperty.call(REPORT_FIELD_CATALOG, field);
}

export function isDimension(field: string): boolean {
  if (!isKnownReportField(field)) return false;
  return REPORT_FIELD_CATALOG[field].fieldKind === 'dimension';
}

export function isMetric(field: string): boolean {
  if (!isKnownReportField(field)) return false;
  return REPORT_FIELD_CATALOG[field].fieldKind === 'metric';
}
