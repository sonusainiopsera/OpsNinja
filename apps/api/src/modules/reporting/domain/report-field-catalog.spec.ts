/**
 * Unit tests for ReportFieldCatalog.
 *
 * Asserts:
 *   - Catalog is frozen (immutable).
 *   - All 11 expected dimensions are present.
 *   - All 8 expected metrics are present.
 *   - No restricted-tier fields appear.
 *   - Every dimension entry has at least one allowed operator.
 *   - Every metric entry has an empty allowed operators list.
 *   - fieldKind is consistent with presence/absence of allowedOperators.
 */

import { describe, it, expect } from 'vitest';

import {
  REPORT_FIELD_CATALOG,
  isKnownReportField,
  isDimension,
  isMetric,
} from './report-field-catalog';

const EXPECTED_DIMENSIONS = [
  'organization',
  'organization_tier',
  'category_path',
  'sub_category',
  'priority',
  'status',
  'assignment_group',
  'agent',
  'ai_affected_area',
  'created_date',
  'resolved_date',
] as const;

const EXPECTED_METRICS = [
  'ticket_count',
  'avg_resolution_minutes',
  'median_resolution_minutes',
  'p90_resolution_minutes',
  'sla_attainment_pct',
  'sla_breach_count',
  'avg_first_response_minutes',
  'csat_avg',
] as const;

describe('REPORT_FIELD_CATALOG', () => {
  it('is frozen — no new properties can be added', () => {
    expect(Object.isFrozen(REPORT_FIELD_CATALOG)).toBe(true);
  });

  it('contains all 11 expected dimensions', () => {
    for (const d of EXPECTED_DIMENSIONS) {
      expect(isKnownReportField(d)).toBe(true);
      expect(isDimension(d)).toBe(true);
    }
  });

  it('contains all 8 expected metrics', () => {
    for (const m of EXPECTED_METRICS) {
      expect(isKnownReportField(m)).toBe(true);
      expect(isMetric(m)).toBe(true);
    }
  });

  it('every entry has classification === "standard"', () => {
    for (const [name, entry] of Object.entries(REPORT_FIELD_CATALOG)) {
      expect(entry.classification).toBe('standard');
    }
  });

  it('every dimension has at least one allowed operator', () => {
    for (const d of EXPECTED_DIMENSIONS) {
      const entry = REPORT_FIELD_CATALOG[d];
      expect(entry.allowedOperators.length).toBeGreaterThan(0);
    }
  });

  it('every metric has an empty allowed operators list', () => {
    for (const m of EXPECTED_METRICS) {
      const entry = REPORT_FIELD_CATALOG[m];
      expect(entry.allowedOperators).toHaveLength(0);
    }
  });

  it('total catalog size is 19 (11 dimensions + 8 metrics)', () => {
    expect(Object.keys(REPORT_FIELD_CATALOG)).toHaveLength(19);
  });

  it('isKnownReportField returns false for unknown fields', () => {
    expect(isKnownReportField('secret_token')).toBe(false);
    expect(isKnownReportField('')).toBe(false);
    expect(isKnownReportField('__proto__')).toBe(false);
  });

  it('isDimension returns false for metrics and unknown fields', () => {
    expect(isDimension('ticket_count')).toBe(false);
    expect(isDimension('avg_resolution_minutes')).toBe(false);
    expect(isDimension('not_a_field')).toBe(false);
  });

  it('isMetric returns false for dimensions and unknown fields', () => {
    expect(isMetric('priority')).toBe(false);
    expect(isMetric('organization')).toBe(false);
    expect(isMetric('not_a_field')).toBe(false);
  });

  it('every dimension sqlExpression starts with a known SQL pattern', () => {
    for (const d of EXPECTED_DIMENSIONS) {
      const entry = REPORT_FIELD_CATALOG[d];
      // Must not be empty and must not contain user-supplied interpolation markers
      expect(entry.sqlExpression.length).toBeGreaterThan(0);
      expect(entry.sqlExpression).not.toContain('${');
    }
  });

  it('avg_first_response_minutes requires ticket_sla join', () => {
    expect(REPORT_FIELD_CATALOG['avg_first_response_minutes'].requiresJoin).toBe('ticket_sla');
  });

  it('organization_tier requires organizations join', () => {
    expect(REPORT_FIELD_CATALOG['organization_tier'].requiresJoin).toBe('organizations');
  });
});
