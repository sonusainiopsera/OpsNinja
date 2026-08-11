/**
 * Unit tests for validateReportFilterAst.
 *
 * Covers: valid ASTs, depth rejection, node count rejection,
 * unknown field (REPORT_FILTER_INVALID_FIELD), unknown/disallowed operator
 * (REPORT_FILTER_INVALID_OPERATOR), type mismatch (REPORT_FILTER_TYPE_MISMATCH),
 * reversed between bounds, null/undefined passthrough.
 */

import {
  validateReportFilterAst,
  ReportFilterErrorCode,
} from '../domain/filter-ast.schema';

// ── Helpers ────────────────────────────────────────────────────────────────────

function cond(field: string, operator: string, value?: unknown) {
  return { type: 'condition' as const, field, operator, value };
}

function group(op: 'and' | 'or', ...children: object[]) {
  return { type: 'group' as const, op, children };
}

// ── Happy path ────────────────────────────────────────────────────────────────

describe('validateReportFilterAst — valid cases', () => {
  it('accepts a valid single condition', () => {
    const r = validateReportFilterAst(cond('priority', 'eq', 'p1'));
    expect(r.ok).toBe(true);
    expect(r.ast).toBeDefined();
  });

  it('accepts an AND group of valid conditions', () => {
    const r = validateReportFilterAst(
      group('and', cond('priority', 'in', ['p1', 'p2']), cond('status', 'eq', 'open')),
    );
    expect(r.ok).toBe(true);
  });

  it('accepts is_null (no value)', () => {
    const r = validateReportFilterAst(cond('created_date', 'is_null'));
    expect(r.ok).toBe(true);
  });

  it('accepts is_not_null (no value)', () => {
    const r = validateReportFilterAst(cond('resolved_date', 'is_not_null'));
    expect(r.ok).toBe(true);
  });

  it('accepts between with ISO date tuple', () => {
    const r = validateReportFilterAst(
      cond('created_date', 'between', ['2025-01-01', '2025-12-31']),
    );
    expect(r.ok).toBe(true);
  });

  it('accepts between with relative date token', () => {
    const r = validateReportFilterAst(cond('created_date', 'between', 'last_12_months'));
    expect(r.ok).toBe(true);
  });

  it('returns ok:true with ast=undefined for null input', () => {
    const r = validateReportFilterAst(null);
    expect(r.ok).toBe(true);
    expect(r.ast).toBeUndefined();
  });

  it('returns ok:true with ast=undefined for undefined input', () => {
    const r = validateReportFilterAst(undefined);
    expect(r.ok).toBe(true);
    expect(r.ast).toBeUndefined();
  });

  it('accepts contains operator on text dimension', () => {
    const r = validateReportFilterAst(cond('category_path', 'contains', 'Network'));
    expect(r.ok).toBe(true);
  });
});

// ── Unknown field ─────────────────────────────────────────────────────────────

describe('validateReportFilterAst — unknown field', () => {
  it('rejects an unknown field with REPORT_FILTER_INVALID_FIELD', () => {
    const r = validateReportFilterAst(cond('nonexistent_field', 'eq', 'x'));
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe(ReportFilterErrorCode.REPORT_FILTER_INVALID_FIELD);
  });

  it('rejects SQL injection in field name', () => {
    const r = validateReportFilterAst(cond("priority; DROP TABLE tickets; --", 'eq', 'p1'));
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe(ReportFilterErrorCode.REPORT_FILTER_INVALID_FIELD);
  });

  it('surfaces the field name in the error path', () => {
    const r = validateReportFilterAst(cond('bad_field', 'eq', 'x'));
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.path).toContain('field');
  });
});

// ── Unknown / disallowed operator ─────────────────────────────────────────────

describe('validateReportFilterAst — operator errors', () => {
  it('rejects a totally unknown operator with REPORT_FILTER_INVALID_OPERATOR', () => {
    const r = validateReportFilterAst(cond('priority', 'xyzzy', 'p1'));
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe(ReportFilterErrorCode.REPORT_FILTER_INVALID_OPERATOR);
  });

  it('rejects "contains" on a uuid dimension with REPORT_FILTER_INVALID_OPERATOR', () => {
    const r = validateReportFilterAst(cond('organization', 'contains', 'some-org'));
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe(ReportFilterErrorCode.REPORT_FILTER_INVALID_OPERATOR);
  });

  it('rejects "gt" on an enum dimension with REPORT_FILTER_INVALID_OPERATOR', () => {
    const r = validateReportFilterAst(cond('status', 'gt', 'open'));
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe(ReportFilterErrorCode.REPORT_FILTER_INVALID_OPERATOR);
  });
});

// ── Type mismatch ─────────────────────────────────────────────────────────────

describe('validateReportFilterAst — type mismatch', () => {
  it('rejects wrong enum value for priority', () => {
    const r = validateReportFilterAst(cond('priority', 'eq', 'P9'));
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe(ReportFilterErrorCode.REPORT_FILTER_TYPE_MISMATCH);
  });

  it('rejects empty array for "in"', () => {
    const r = validateReportFilterAst(cond('status', 'in', []));
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe(ReportFilterErrorCode.REPORT_FILTER_TYPE_MISMATCH);
  });

  it('rejects reversed between bounds (start > end)', () => {
    const r = validateReportFilterAst(
      cond('created_date', 'between', ['2025-12-31', '2025-01-01']),
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe(ReportFilterErrorCode.REPORT_FILTER_TYPE_MISMATCH);
  });

  it('rejects non-array for "in"', () => {
    const r = validateReportFilterAst(cond('priority', 'in', 'p1'));
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe(ReportFilterErrorCode.REPORT_FILTER_TYPE_MISMATCH);
  });
});

// ── Depth and count guards ────────────────────────────────────────────────────

describe('validateReportFilterAst — depth / count guards', () => {
  function buildDeep(depth: number): object {
    if (depth === 0) return cond('priority', 'eq', 'p1');
    return group('and', buildDeep(depth - 1));
  }

  it('accepts max depth 4', () => {
    const r = validateReportFilterAst(buildDeep(4), { maxDepth: 4 });
    expect(r.ok).toBe(true);
  });

  it('rejects depth 5 with REPORT_FILTER_TOO_DEEP', () => {
    const r = validateReportFilterAst(buildDeep(5), { maxDepth: 4 });
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe(ReportFilterErrorCode.REPORT_FILTER_TOO_DEEP);
  });

  it('rejects node count over 50 with REPORT_FILTER_TOO_LARGE', () => {
    const children = Array.from({ length: 51 }, () => cond('priority', 'eq', 'p1'));
    const big = group('and', ...children);
    const r = validateReportFilterAst(big, { maxConditions: 50 });
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe(ReportFilterErrorCode.REPORT_FILTER_TOO_LARGE);
  });
});

// ── Structural parse errors ───────────────────────────────────────────────────

describe('validateReportFilterAst — structural parse errors', () => {
  it('rejects a number as root with REPORT_FILTER_PARSE_ERROR', () => {
    const r = validateReportFilterAst(42);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe(ReportFilterErrorCode.REPORT_FILTER_PARSE_ERROR);
  });

  it('rejects extra properties on a condition node', () => {
    const r = validateReportFilterAst({
      type: 'condition', field: 'priority', operator: 'eq', value: 'p1', injected: 'extra',
    });
    expect(r.ok).toBe(false);
  });
});
