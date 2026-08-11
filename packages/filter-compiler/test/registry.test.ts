/**
 * registry.test.ts — exhaustive matrix: for every registered field,
 * test every allowed operator with a valid value, and every disallowed
 * operator is rejected.
 */

import { describe, it, expect } from 'vitest';

import { FIELD_REGISTRY } from '../src/field-registry';
import { OPERATORS, type Operator } from '../src/operators';
import { validateFilterAst } from '../src/validate';
import { compileToPredicate } from '../src/compile';
import { FixedClock } from '../src/clock';

const clock = new FixedClock(new Date('2024-06-15T12:00:00Z'));

// ---------------------------------------------------------------------------
// Representative valid values per field for testing
// ---------------------------------------------------------------------------

const VALID_SCALAR_VALUES: Record<string, unknown> = {
  status: 'open',
  priority: 'P1',
  category_id: '00000000-0000-0000-0000-000000000001',
  category_path: 'billing/invoice',
  tag_id: '00000000-0000-0000-0000-000000000002',
  assignment_group_id: '00000000-0000-0000-0000-000000000003',
  assignee_user_id: '00000000-0000-0000-0000-000000000004',
  organization_id: '00000000-0000-0000-0000-000000000005',
  sla_state: 'ok',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  resolved_at: '2024-01-01T00:00:00Z',
  has_jira_link: true,
  affected_area: '00000000-0000-0000-0000-000000000006',
};

const VALID_ARRAY_VALUES: Record<string, unknown[]> = {
  status: ['open', 'in_progress'],
  priority: ['P1', 'P2'],
  category_id: ['00000000-0000-0000-0000-000000000001'],
  tag_id: ['00000000-0000-0000-0000-000000000002'],
  assignment_group_id: ['00000000-0000-0000-0000-000000000003'],
  assignee_user_id: ['00000000-0000-0000-0000-000000000004'],
  organization_id: ['00000000-0000-0000-0000-000000000005'],
  sla_state: ['ok', 'warning'],
  affected_area: ['00000000-0000-0000-0000-000000000006'],
};

const VALID_RANGE_VALUES: Record<string, unknown> = {
  created_at: ['2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z'],
  updated_at: ['2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z'],
  resolved_at: ['2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z'],
};

function getTestValue(field: string, op: Operator): unknown {
  if (op === 'in' || op === 'not_in') return VALID_ARRAY_VALUES[field] ?? ['open'];
  if (op === 'between') return VALID_RANGE_VALUES[field] ?? ['2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z'];
  if (op === 'is_null' || op === 'is_not_null') return null;
  if (op === 'contains') return 'search term';
  return VALID_SCALAR_VALUES[field];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Field registry — allowed operators compile successfully', () => {
  for (const [field, entry] of Object.entries(FIELD_REGISTRY)) {
    for (const op of entry.allowedOperators) {
      it(`${field}.${op} compiles without error`, () => {
        const value = getTestValue(field, op as Operator);
        const raw = { type: 'condition', field, operator: op, value };
        const validated = validateFilterAst(raw as never);
        if (!validated.success) {
          // Log for debugging but fail the test
          throw new Error(`Validation failed for ${field}.${op}: ${JSON.stringify(validated.errors)}`);
        }
        expect(validated.success).toBe(true);
        const compiled = compileToPredicate(validated.data, { clock });
        expect(compiled.sql).toBeTruthy();
        // SQL must contain $n placeholders for any non-null-check operator
        if (op !== 'is_null' && op !== 'is_not_null') {
          expect(compiled.sql).toMatch(/\$\d/);
        }
      });
    }
  }
});

describe('Field registry — disallowed operators are rejected', () => {
  for (const [field, entry] of Object.entries(FIELD_REGISTRY)) {
    const disallowed = OPERATORS.filter(
      (op) => !(entry.allowedOperators as readonly string[]).includes(op),
    );
    for (const op of disallowed) {
      it(`${field}.${op} is rejected with OPERATOR_NOT_ALLOWED`, () => {
        const value = getTestValue(field, op as Operator);
        const raw = { type: 'condition', field, operator: op, value };
        const result = validateFilterAst(raw as never);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.errors.some(e => e.code === 'OPERATOR_NOT_ALLOWED')).toBe(true);
        }
      });
    }
  }
});

describe('Field registry — invalid values are rejected', () => {
  it('status: invalid enum value rejected', () => {
    const r = validateFilterAst({ type: 'condition', field: 'status', operator: 'eq', value: 'INVALID_STATUS' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.some(e => e.code === 'INVALID_VALUE')).toBe(true);
  });

  it('priority: invalid enum value rejected', () => {
    const r = validateFilterAst({ type: 'condition', field: 'priority', operator: 'eq', value: 'P5' });
    expect(r.success).toBe(false);
  });

  it('organization_id: malformed UUID rejected', () => {
    const r = validateFilterAst({ type: 'condition', field: 'organization_id', operator: 'eq', value: 'not-uuid' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.some(e => e.code === 'INVALID_VALUE')).toBe(true);
  });

  it('created_at: invalid date string rejected', () => {
    const r = validateFilterAst({ type: 'condition', field: 'created_at', operator: 'eq', value: 'not-a-date' });
    expect(r.success).toBe(false);
  });

  it('created_at: valid relative date token accepted', () => {
    const r = validateFilterAst({ type: 'condition', field: 'created_at', operator: 'gte', value: 'last_7_days' });
    expect(r.success).toBe(true);
  });

  it('created_at: invalid relative-date-like string rejected', () => {
    const r = validateFilterAst({ type: 'condition', field: 'created_at', operator: 'gte', value: 'last_999_days' });
    expect(r.success).toBe(false);
  });

  it('sla_state: invalid value rejected', () => {
    const r = validateFilterAst({ type: 'condition', field: 'sla_state', operator: 'eq', value: 'critical' });
    expect(r.success).toBe(false);
  });

  it('has_jira_link: string value rejected', () => {
    const r = validateFilterAst({ type: 'condition', field: 'has_jira_link', operator: 'eq', value: 'true' });
    expect(r.success).toBe(false);
  });
});
