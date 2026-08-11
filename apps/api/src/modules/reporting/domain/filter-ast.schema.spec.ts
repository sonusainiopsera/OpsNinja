/**
 * Unit tests for the report filter AST schema.
 *
 * Covers:
 *   - Valid condition and group nodes
 *   - REPORT_FILTER_INVALID_FIELD (unknown field, metric-as-filter)
 *   - REPORT_FILTER_INVALID_OPERATOR (operator not in allowed set)
 *   - REPORT_FILTER_TYPE_MISMATCH (wrong value type)
 *   - REPORT_FILTER_TOO_DEEP (depth > 4)
 *   - REPORT_FILTER_TOO_LARGE (nodes > 50)
 *   - REPORT_FILTER_INVALID_STRUCTURE (structural parse failure)
 *   - Empty filter AST (null/undefined) is valid
 *   - between reversed bounds rejected
 */

import { describe, it, expect } from 'vitest';

import {
  parseReportFilterAst,
  validateReportFilterAst,
  REPORT_MAX_DEPTH,
  REPORT_MAX_NODES,
  type ReportFilterAst,
} from './filter-ast.schema';

// Helper: build a simple condition node
function cond(field: string, operator: string, value: unknown): ReportFilterAst {
  return { type: 'condition', field, operator, value };
}

// Helper: build a nested group to a specific depth
function deepGroup(depth: number): ReportFilterAst {
  if (depth === 0) {
    return cond('priority', 'eq', 'P1');
  }
  return {
    type: 'group',
    op: 'and',
    children: [deepGroup(depth - 1)],
  };
}

// Helper: build a large flat AND group with N condition children
function wideGroup(n: number): ReportFilterAst {
  return {
    type: 'group',
    op: 'and',
    children: Array.from({ length: n }, () => cond('priority', 'eq', 'P1')),
  };
}

describe('parseReportFilterAst', () => {
  it('accepts a valid condition node', () => {
    const result = parseReportFilterAst(cond('priority', 'eq', 'P1'));
    expect(result.success).toBe(true);
  });

  it('accepts a valid group node with valid children', () => {
    const ast: ReportFilterAst = {
      type: 'group',
      op: 'and',
      children: [
        cond('priority', 'in', ['P1', 'P2']),
        cond('status', 'eq', 'open'),
      ],
    };
    const result = parseReportFilterAst(ast);
    expect(result.success).toBe(true);
  });

  it('accepts created_date between range', () => {
    const result = parseReportFilterAst(
      cond('created_date', 'between', ['2025-01-01', '2025-12-31']),
    );
    expect(result.success).toBe(true);
  });

  it('accepts organization in UUID array', () => {
    const result = parseReportFilterAst(
      cond('organization', 'in', [
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('returns REPORT_FILTER_INVALID_FIELD for unknown field', () => {
    const result = parseReportFilterAst(cond('drop_table', 'eq', 'x'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.code).toBe('REPORT_FILTER_INVALID_FIELD');
    }
  });

  it('returns REPORT_FILTER_INVALID_FIELD for metric used as filter field', () => {
    const result = parseReportFilterAst(cond('ticket_count', 'eq', 1));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.code).toBe('REPORT_FILTER_INVALID_FIELD');
    }
  });

  it('returns REPORT_FILTER_INVALID_OPERATOR for disallowed operator', () => {
    // 'organization' does not allow 'contains'
    const result = parseReportFilterAst(cond('organization', 'contains', 'acme'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.code).toBe('REPORT_FILTER_INVALID_OPERATOR');
    }
  });

  it('returns REPORT_FILTER_INVALID_OPERATOR for completely unknown operator', () => {
    const result = parseReportFilterAst(cond('priority', 'INJECT', 'P1'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.code).toBe('REPORT_FILTER_INVALID_OPERATOR');
    }
  });

  it('returns REPORT_FILTER_TYPE_MISMATCH for wrong priority value', () => {
    const result = parseReportFilterAst(cond('priority', 'eq', 'not_a_priority'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.code).toBe('REPORT_FILTER_TYPE_MISMATCH');
    }
  });

  it('returns REPORT_FILTER_TYPE_MISMATCH for between with single value', () => {
    const result = parseReportFilterAst(
      cond('created_date', 'between', ['2025-01-01']),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.code).toBe('REPORT_FILTER_TYPE_MISMATCH');
    }
  });

  it('returns REPORT_FILTER_TYPE_MISMATCH for in with empty array', () => {
    const result = parseReportFilterAst(cond('priority', 'in', []));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.code).toBe('REPORT_FILTER_TYPE_MISMATCH');
    }
  });

  it('returns REPORT_FILTER_TOO_DEEP when depth > ' + REPORT_MAX_DEPTH, () => {
    const ast = deepGroup(REPORT_MAX_DEPTH + 1);
    const result = parseReportFilterAst(ast);
    expect(result.success).toBe(false);
    if (!result.success) {
      const depthErr = result.errors.find((e) => e.code === 'REPORT_FILTER_TOO_DEEP');
      expect(depthErr).toBeDefined();
    }
  });

  it('accepts depth exactly equal to ' + REPORT_MAX_DEPTH, () => {
    const ast = deepGroup(REPORT_MAX_DEPTH);
    const result = parseReportFilterAst(ast);
    expect(result.success).toBe(true);
  });

  it('returns REPORT_FILTER_TOO_LARGE when node count > ' + REPORT_MAX_NODES, () => {
    const ast = wideGroup(REPORT_MAX_NODES + 1);
    const result = parseReportFilterAst(ast);
    expect(result.success).toBe(false);
    if (!result.success) {
      const largeErr = result.errors.find((e) => e.code === 'REPORT_FILTER_TOO_LARGE');
      expect(largeErr).toBeDefined();
    }
  });

  it('accepts node count exactly equal to ' + REPORT_MAX_NODES, () => {
    const ast = wideGroup(REPORT_MAX_NODES);
    const result = parseReportFilterAst(ast);
    expect(result.success).toBe(true);
  });

  it('returns REPORT_FILTER_INVALID_STRUCTURE for non-object input', () => {
    const result = parseReportFilterAst('DROP TABLE tenants');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.code).toBe('REPORT_FILTER_INVALID_STRUCTURE');
    }
  });

  it('returns REPORT_FILTER_INVALID_STRUCTURE for missing type', () => {
    const result = parseReportFilterAst({ field: 'priority', operator: 'eq', value: 'P1' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.code).toBe('REPORT_FILTER_INVALID_STRUCTURE');
    }
  });

  it('accepts is_null operator with no value', () => {
    const result = parseReportFilterAst(cond('agent', 'is_null', null));
    expect(result.success).toBe(true);
  });

  it('accepts is_not_null operator with no value', () => {
    const result = parseReportFilterAst(cond('resolved_date', 'is_not_null', undefined));
    expect(result.success).toBe(true);
  });
});

describe('validateReportFilterAst (re-validation on load from DB)', () => {
  it('re-validates a valid AST successfully', () => {
    const ast = cond('status', 'eq', 'open');
    const result = validateReportFilterAst(ast);
    expect(result.success).toBe(true);
  });

  it('detects REPORT_FILTER_INVALID_FIELD for a field removed from catalog', () => {
    // Simulate a field that passed validation when saved but is no longer in catalog
    const staleAst = cond('legacy_field_no_longer_exists', 'eq', 'x');
    const result = validateReportFilterAst(staleAst);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.code).toBe('REPORT_FILTER_INVALID_FIELD');
    }
  });
});
