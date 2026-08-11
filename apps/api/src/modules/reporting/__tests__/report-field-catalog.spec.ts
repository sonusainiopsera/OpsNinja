/**
 * Unit tests for ReportFieldCatalog.
 *
 * Verifies:
 *  - Catalog is frozen (no mutation possible)
 *  - No Restricted-tier entries exist
 *  - Every dimension has a non-empty groupByExpr, filterColumnExpr, allowedOperators
 *  - Every metric has a non-empty aggregateExpr
 *  - Lookup helpers return correct values
 */

import {
  DIMENSION_CATALOG,
  METRIC_CATALOG,
  getDimensionDef,
  getMetricDef,
  isKnownDimension,
  isKnownMetric,
  ALL_DIMENSION_NAMES,
  ALL_METRIC_NAMES,
} from '../domain/report-field-catalog';

describe('ReportFieldCatalog — dimensions', () => {
  it('catalog is frozen', () => {
    expect(Object.isFrozen(DIMENSION_CATALOG)).toBe(true);
  });

  it('contains all required dimensions from AC3', () => {
    const required = [
      'organization', 'organization_tier', 'category_path', 'sub_category',
      'priority', 'status', 'assignment_group', 'agent',
      'ai_affected_area', 'created_date', 'resolved_date',
    ];
    for (const d of required) {
      expect(isKnownDimension(d)).toBe(true);
    }
  });

  it('every dimension has a non-empty groupByExpr', () => {
    for (const [name, def] of Object.entries(DIMENSION_CATALOG)) {
      expect(def.groupByExpr.length, `dimension "${name}" groupByExpr`).toBeGreaterThan(0);
    }
  });

  it('every dimension has a non-empty filterColumnExpr', () => {
    for (const [name, def] of Object.entries(DIMENSION_CATALOG)) {
      expect(def.filterColumnExpr.length, `dimension "${name}" filterColumnExpr`).toBeGreaterThan(0);
    }
  });

  it('every dimension has at least one allowed operator', () => {
    for (const [name, def] of Object.entries(DIMENSION_CATALOG)) {
      expect(def.allowedOperators.length, `dimension "${name}" allowedOperators`).toBeGreaterThan(0);
    }
  });

  it('every dimension has a value schema', () => {
    for (const [name, def] of Object.entries(DIMENSION_CATALOG)) {
      expect(def.valueSchema, `dimension "${name}" valueSchema`).toBeDefined();
    }
  });

  it('no dimension has classification "restricted"', () => {
    for (const [name, def] of Object.entries(DIMENSION_CATALOG)) {
      expect((def as { classification: string }).classification, `dimension "${name}"`).not.toBe('restricted');
    }
  });

  it('ALL_DIMENSION_NAMES matches catalog keys', () => {
    expect(new Set(ALL_DIMENSION_NAMES)).toEqual(new Set(Object.keys(DIMENSION_CATALOG)));
  });
});

describe('ReportFieldCatalog — metrics', () => {
  it('catalog is frozen', () => {
    expect(Object.isFrozen(METRIC_CATALOG)).toBe(true);
  });

  it('contains all required metrics from AC3', () => {
    const required = [
      'ticket_count', 'avg_resolution_minutes', 'median_resolution_minutes',
      'p90_resolution_minutes', 'sla_attainment_pct', 'sla_breach_count',
      'avg_first_response_minutes', 'csat_avg',
    ];
    for (const m of required) {
      expect(isKnownMetric(m)).toBe(true);
    }
  });

  it('every metric has a non-empty aggregateExpr', () => {
    for (const [name, def] of Object.entries(METRIC_CATALOG)) {
      expect(def.aggregateExpr.length, `metric "${name}" aggregateExpr`).toBeGreaterThan(0);
    }
  });

  it('every metric has a declared dataType', () => {
    const validTypes = new Set(['integer', 'numeric', 'percentage']);
    for (const [name, def] of Object.entries(METRIC_CATALOG)) {
      expect(validTypes.has(def.dataType), `metric "${name}" dataType "${def.dataType}"`).toBe(true);
    }
  });

  it('no metric has classification "restricted"', () => {
    for (const [name, def] of Object.entries(METRIC_CATALOG)) {
      expect((def as { classification: string }).classification, `metric "${name}"`).not.toBe('restricted');
    }
  });

  it('ALL_METRIC_NAMES matches catalog keys', () => {
    expect(new Set(ALL_METRIC_NAMES)).toEqual(new Set(Object.keys(METRIC_CATALOG)));
  });
});

describe('ReportFieldCatalog — lookup helpers', () => {
  it('getDimensionDef returns undefined for unknown name', () => {
    expect(getDimensionDef('does_not_exist')).toBeUndefined();
  });

  it('getDimensionDef returns def for known dimension', () => {
    const def = getDimensionDef('priority');
    expect(def).toBeDefined();
    expect(def!.filterColumnExpr).toBe('t.priority');
  });

  it('getMetricDef returns undefined for unknown name', () => {
    expect(getMetricDef('does_not_exist')).toBeUndefined();
  });

  it('getMetricDef returns def for known metric', () => {
    const def = getMetricDef('ticket_count');
    expect(def).toBeDefined();
    expect(def!.aggregateExpr).toContain('COUNT(*)');
  });

  it('isKnownDimension returns false for SQL injection attempt', () => {
    expect(isKnownDimension("priority; DROP TABLE tickets; --")).toBe(false);
  });

  it('isKnownMetric returns false for SQL injection attempt', () => {
    expect(isKnownMetric("ticket_count; SELECT 1 --")).toBe(false);
  });
});
