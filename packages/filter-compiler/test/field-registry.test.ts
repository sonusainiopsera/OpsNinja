import { describe, it, expect } from 'vitest';
import { FIELD_REGISTRY, getFieldDef, isKnownField } from '../src/field-registry';
import { OPERATORS, isOperator } from '../src/operators';
import { validateFilterAst } from '../src/compile';
import type { FilterAst } from '../src/ast';

describe('Field registry', () => {
  it('exports all required fields', () => {
    const requiredFields = [
      'status', 'priority', 'category_id', 'category_path',
      'tag_id', 'assignment_group_id', 'assignee_user_id',
      'organization_id', 'sla_state', 'created_at', 'updated_at',
      'resolved_at', 'has_jira_link', 'affected_area',
    ];
    for (const field of requiredFields) {
      expect(isKnownField(field), `expected ${field} to be in registry`).toBe(true);
    }
  });

  it('every field has a non-empty allowedOps list', () => {
    for (const [name, def] of Object.entries(FIELD_REGISTRY)) {
      expect(def.allowedOps.length, `${name}.allowedOps should not be empty`).toBeGreaterThan(0);
    }
  });

  it('all allowedOps are valid operator names', () => {
    for (const [name, def] of Object.entries(FIELD_REGISTRY)) {
      for (const op of def.allowedOps) {
        expect(isOperator(op), `${name}: "${op}" is not a valid operator`).toBe(true);
      }
    }
  });

  it('exists-type fields have an existsSubquery defined', () => {
    for (const [name, def] of Object.entries(FIELD_REGISTRY)) {
      if (def.sqlType === 'exists') {
        expect(def.existsSubquery, `${name} should have existsSubquery`).toBeDefined();
        expect(def.existsSubquery).toContain('{placeholder}');
      }
    }
  });

  it('getFieldDef returns undefined for unknown field', () => {
    expect(getFieldDef('not_a_real_field')).toBeUndefined();
  });

  it('getFieldDef returns the definition for a known field', () => {
    const def = getFieldDef('status');
    expect(def).toBeDefined();
    expect(def?.sqlType).toBe('enum');
  });
});

// Per-field operator matrix — allowed operators must compile; disallowed must reject

describe('Operator allow-list matrix', () => {
  const allOps = OPERATORS;

  function testFieldOp(
    field: string,
    operator: string,
    value: unknown,
    shouldPass: boolean,
  ) {
    const ast: FilterAst = {
      type: 'condition',
      field,
      operator,
      value,
    };
    const r = validateFilterAst(ast);
    if (shouldPass) {
      expect(r.ok, `${field}+${operator} should pass but failed: ${!r.ok ? JSON.stringify((r as { errors: unknown[] }).errors) : ''}`).toBe(true);
    } else {
      expect(r.ok, `${field}+${operator} should fail but passed`).toBe(false);
    }
  }

  it('status: allowed ops pass', () => {
    testFieldOp('status', 'eq', 'open', true);
    testFieldOp('status', 'neq', 'open', true);
    testFieldOp('status', 'in', ['open', 'closed'], true);
    testFieldOp('status', 'not_in', ['resolved'], true);
    testFieldOp('status', 'is_null', null, true);
    testFieldOp('status', 'is_not_null', null, true);
  });

  it('status: disallowed ops fail', () => {
    testFieldOp('status', 'contains', 'open', false);
    testFieldOp('status', 'gt', 'open', false);
    testFieldOp('status', 'between', ['open', 'closed'], false);
  });

  it('created_at: allowed ops pass', () => {
    testFieldOp('created_at', 'gt', '2024-01-01', true);
    testFieldOp('created_at', 'lte', '2024-12-31', true);
    testFieldOp('created_at', 'between', ['2024-01-01', '2024-12-31'], true);
    testFieldOp('created_at', 'between', 'last_7_days', true);
    testFieldOp('created_at', 'is_null', null, true);
  });

  it('created_at: disallowed ops fail', () => {
    testFieldOp('created_at', 'contains', '2024', false);
    testFieldOp('created_at', 'in', ['2024-01-01'], false);
  });

  it('category_path: contains is allowed', () => {
    testFieldOp('category_path', 'contains', 'infra', true);
  });

  it('tag_id: only eq and in are allowed', () => {
    testFieldOp('tag_id', 'eq', '11111111-1111-1111-1111-111111111111', true);
    testFieldOp('tag_id', 'in', ['11111111-1111-1111-1111-111111111111'], true);
    testFieldOp('tag_id', 'neq', '11111111-1111-1111-1111-111111111111', false);
    testFieldOp('tag_id', 'not_in', ['11111111-1111-1111-1111-111111111111'], false);
  });

  it('has_jira_link: only eq, is_null, is_not_null', () => {
    testFieldOp('has_jira_link', 'eq', true, true);
    testFieldOp('has_jira_link', 'is_null', null, true);
    testFieldOp('has_jira_link', 'is_not_null', null, true);
    testFieldOp('has_jira_link', 'neq', false, false);
  });

  it('sla_state: enum values validated', () => {
    testFieldOp('sla_state', 'eq', 'running', true);
    testFieldOp('sla_state', 'eq', 'invalid_state', false);
    testFieldOp('sla_state', 'in', ['warning', 'breached'], true);
    testFieldOp('sla_state', 'in', ['unknown_state'], false);
  });

  it('organization_id: requires UUID format', () => {
    testFieldOp('organization_id', 'eq', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
    testFieldOp('organization_id', 'eq', 'not-a-uuid', false);
    testFieldOp('organization_id', 'eq', "'; DROP TABLE--", false);
  });

  it('priority: invalid enum value fails', () => {
    testFieldOp('priority', 'eq', 'critical', false);
    testFieldOp('priority', 'in', ['p1', 'invalid'], false);
  });
});
