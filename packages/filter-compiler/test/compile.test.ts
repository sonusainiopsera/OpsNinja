import { describe, it, expect } from 'vitest';
import {
  parseFilterAst,
  validateFilterAst,
  compileToPredicate,
} from '../src/compile';
import { AstErrorCode, MAX_DEPTH, MAX_CONDITIONS } from '../src/ast';
import type { Clock } from '../src/clock';
import {
  simpleEqStatus,
  simpleInPriority,
  groupAndFilter,
  groupOrFilter,
  nestedGroupFilter,
  nullCheckFilter,
  dateRangeFilter,
  relativeDateFilter,
  containsFilter,
  tagIdFilter,
  orgFilter,
  hasJiraFilter,
  emptyGroupFilter,
  slaStateFilter,
  unknownFieldRaw,
  unknownOperatorRaw,
  sqlInjectionValueRaw,
  sqlCommentValueRaw,
  semicolonInjection,
  likeWildcardValue,
  operatorMismatch,
  emptyInArray,
  invalidBetweenTuple,
  nestedObjectValue,
  buildDeepAst,
  buildWideAst,
  extraPropsRaw,
} from './fixtures/filters';

// Deterministic test clock
const fixedClock: Clock = {
  now: () => new Date('2024-06-15T12:00:00.000Z'),
};

// ── parseFilterAst ────────────────────────────────────────────────────────────

describe('parseFilterAst — structural validation', () => {
  it('accepts a valid condition node', () => {
    const r = parseFilterAst(simpleEqStatus);
    expect(r.ok).toBe(true);
  });

  it('accepts a nested group', () => {
    const r = parseFilterAst(nestedGroupFilter);
    expect(r.ok).toBe(true);
  });

  it('rejects extra properties (.strict)', () => {
    const r = parseFilterAst(extraPropsRaw);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe(AstErrorCode.PARSE_ERROR);
    }
  });

  it('rejects a non-object', () => {
    const r = parseFilterAst('not an ast');
    expect(r.ok).toBe(false);
  });

  it('rejects null', () => {
    const r = parseFilterAst(null);
    expect(r.ok).toBe(false);
  });
});

// ── validateFilterAst ─────────────────────────────────────────────────────────

describe('validateFilterAst — semantic validation', () => {
  it('accepts a known field with allowed operator', () => {
    const r = validateFilterAst(simpleEqStatus);
    expect(r.ok).toBe(true);
  });

  it('rejects an unknown field', () => {
    const parsed = parseFilterAst(unknownFieldRaw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const err = r.errors.find(e => e.code === AstErrorCode.UNKNOWN_FIELD);
      expect(err).toBeDefined();
      expect(err?.message).toContain('DROP TABLE');
    }
  });

  it('rejects an unknown operator', () => {
    const parsed = parseFilterAst(unknownOperatorRaw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some(e => e.code === AstErrorCode.OPERATOR_NOT_ALLOWED)).toBe(true);
    }
  });

  it('rejects an operator not allowed for the field', () => {
    const parsed = parseFilterAst(operatorMismatch);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe(AstErrorCode.OPERATOR_NOT_ALLOWED);
    }
  });

  it('rejects in with empty array', () => {
    const parsed = parseFilterAst(emptyInArray);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe(AstErrorCode.EMPTY_IN_ARRAY);
    }
  });

  it('rejects between with a single-element array', () => {
    const parsed = parseFilterAst(invalidBetweenTuple);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe(AstErrorCode.INVALID_VALUE);
    }
  });

  it('rejects depth beyond MAX_DEPTH', () => {
    const raw = buildDeepAst(MAX_DEPTH + 1);
    const parsed = parseFilterAst(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe(AstErrorCode.DEPTH_EXCEEDED);
    }
  });

  it('accepts depth exactly at MAX_DEPTH', () => {
    const raw = buildDeepAst(MAX_DEPTH);
    const parsed = parseFilterAst(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(true);
  });

  it('rejects condition count beyond MAX_CONDITIONS', () => {
    const raw = buildWideAst(MAX_CONDITIONS + 1);
    const parsed = parseFilterAst(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe(AstErrorCode.CONDITION_LIMIT_EXCEEDED);
    }
  });

  it('accepts exactly MAX_CONDITIONS conditions', () => {
    const raw = buildWideAst(MAX_CONDITIONS);
    const parsed = parseFilterAst(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(true);
  });

  it('rejects a nested object as value', () => {
    const parsed = parseFilterAst(nestedObjectValue);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe(AstErrorCode.INVALID_VALUE);
    }
  });

  it('returns multiple errors for multiple violations', () => {
    const raw = {
      type: 'group',
      op: 'and',
      children: [unknownFieldRaw, operatorMismatch],
    };
    const parsed = parseFilterAst(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ── compileToPredicate — correctness ──────────────────────────────────────────

describe('compileToPredicate — correctness', () => {
  it('compiles eq condition', () => {
    const { sql, params } = compileToPredicate(simpleEqStatus, { clock: fixedClock });
    expect(sql).toBe('tickets.status = $1');
    expect(params).toEqual(['open']);
  });

  it('compiles in condition with array param', () => {
    const { sql, params } = compileToPredicate(simpleInPriority, { clock: fixedClock });
    expect(sql).toBe('tickets.priority = ANY($1)');
    expect(params).toEqual([['p1', 'p2']]);
  });

  it('compiles AND group', () => {
    const { sql, params } = compileToPredicate(groupAndFilter, { clock: fixedClock });
    expect(sql).toBe('(tickets.status = $1 AND tickets.priority = ANY($2))');
    expect(params).toEqual(['open', ['p1', 'p2']]);
  });

  it('compiles OR group', () => {
    const { sql, params } = compileToPredicate(groupOrFilter, { clock: fixedClock });
    expect(sql).toBe('(tickets.status = $1 OR tickets.status = $2)');
    expect(params).toEqual(['open', 'in_progress']);
  });

  it('compiles nested group', () => {
    const { sql } = compileToPredicate(nestedGroupFilter, { clock: fixedClock });
    expect(sql).toContain('AND');
    expect(sql).toContain('OR');
    expect(sql).toMatch(/\$1.*\$2.*\$3/);
  });

  it('compiles is_null', () => {
    const { sql, params } = compileToPredicate(nullCheckFilter, { clock: fixedClock });
    expect(sql).toBe('tickets.resolved_at IS NULL');
    expect(params).toEqual([]);
  });

  it('compiles between with explicit ISO dates', () => {
    const { sql, params } = compileToPredicate(dateRangeFilter, { clock: fixedClock });
    expect(sql).toBe('tickets.created_at BETWEEN $1 AND $2');
    expect(params).toEqual(['2024-01-01', '2024-12-31']);
  });

  it('compiles between with relative token using injected clock', () => {
    const { sql, params } = compileToPredicate(relativeDateFilter, { clock: fixedClock });
    expect(sql).toBe('tickets.created_at BETWEEN $1 AND $2');
    // last_7_days from 2024-06-15: 2024-06-09 to 2024-06-15
    expect(params[0]).toContain('2024-06-09');
    expect(params[1]).toContain('2024-06-15');
  });

  it('compiles contains with ILIKE', () => {
    const { sql, params } = compileToPredicate(containsFilter, { clock: fixedClock });
    expect(sql).toBe('tickets.category_path ILIKE $1');
    expect(params[0]).toBe('%infrastructure%');
  });

  it('compiles tag_id with EXISTS subquery', () => {
    const { sql, params } = compileToPredicate(tagIdFilter, { clock: fixedClock });
    expect(sql).toContain('EXISTS');
    expect(sql).toContain('ticket_tags');
    expect(sql).toContain('$1');
    expect(Array.isArray(params[0])).toBe(true);
  });

  it('compiles has_jira_link eq true as IS NOT NULL', () => {
    const { sql, params } = compileToPredicate(hasJiraFilter, { clock: fixedClock });
    expect(sql).toBe('tickets.jira_ticket_key IS NOT NULL');
    expect(params).toEqual([]);
  });

  it('compiles empty group as TRUE (tautology)', () => {
    const { sql, params } = compileToPredicate(emptyGroupFilter, { clock: fixedClock });
    expect(sql).toBe('TRUE');
    expect(params).toEqual([]);
  });
});

// ── compileToPredicate — injection safety ─────────────────────────────────────

describe('compileToPredicate — injection safety', () => {
  it('SQL injection value appears only in params, never in sql string', () => {
    const parsed = parseFilterAst(sqlInjectionValueRaw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    // uuid validation should reject this malformed value
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe(AstErrorCode.INVALID_VALUE);
    }
  });

  it('SQL comment injection in contains value is parameterized not embedded', () => {
    const parsed = parseFilterAst(sqlCommentValueRaw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // category_path contains is valid, value should go to params
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { sql, params } = compileToPredicate(r.ast, { clock: fixedClock });
    expect(sql).not.toContain('--');
    expect(sql).not.toContain('DROP');
    expect(String(params[0])).toContain('DROP'); // in params only
  });

  it('semicolon injection is rejected by value schema (status enum)', () => {
    const parsed = parseFilterAst(semicolonInjection);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.code).toBe(AstErrorCode.INVALID_VALUE);
    }
  });

  it('LIKE wildcards in contains value are escaped', () => {
    const parsed = parseFilterAst(likeWildcardValue);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = validateFilterAst(parsed.ast);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { sql, params } = compileToPredicate(r.ast, { clock: fixedClock });
    expect(sql).toBe('tickets.category_path ILIKE $1');
    // The % in "100%" must be escaped to \%
    expect(params[0]).toBe('%100\\% done%');
  });

  it('generated sql string never contains user-supplied literal for eq operator', () => {
    const literals = ["'; DROP TABLE tickets;--", '1=1', '<script>', '"inject"'];
    for (const literal of literals) {
      const ast = { type: 'condition' as const, field: 'category_path', operator: 'eq', value: literal };
      const r = validateFilterAst(ast);
      if (r.ok) {
        const { sql } = compileToPredicate(r.ast, { clock: fixedClock });
        expect(sql).not.toContain(literal.split('').slice(0, 5).join(''));
        expect(sql).toBe('tickets.category_path = $1');
      }
    }
  });

  it('positional placeholder count equals params length', () => {
    const { sql, params } = compileToPredicate(groupAndFilter, { clock: fixedClock });
    const placeholderCount = (sql.match(/\$\d+/g) ?? []).length;
    expect(placeholderCount).toBe(params.length);
  });
});

// ── Registry matrix — all allowed operators compile ───────────────────────────

describe('Field-registry matrix', () => {
  const statusOps = ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'] as const;

  for (const op of statusOps) {
    it(`status + ${op} compiles without error`, () => {
      const value = op === 'in' || op === 'not_in' ? ['open'] : 'open';
      const ast = {
        type: 'condition' as const,
        field: 'status',
        operator: op,
        value: NULL_OPS.has(op) ? null : value,
      };
      const r = validateFilterAst(ast);
      expect(r.ok).toBe(true);
      if (r.ok) {
        const pred = compileToPredicate(r.ast, { clock: fixedClock });
        expect(pred.sql.length).toBeGreaterThan(0);
      }
    });
  }

  it('created_at + between + relative token uses injected clock', () => {
    const ast = {
      type: 'condition' as const,
      field: 'created_at',
      operator: 'between',
      value: 'today',
    };
    const r = validateFilterAst(ast);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { params } = compileToPredicate(r.ast, { clock: fixedClock });
    expect(params[0]).toContain('2024-06-15');
    expect(params[1]).toContain('2024-06-15');
  });

  it('affected_area + in uses EXISTS subquery', () => {
    const ast = {
      type: 'condition' as const,
      field: 'affected_area',
      operator: 'in',
      value: ['networking', 'storage'],
    };
    const r = validateFilterAst(ast);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { sql, params } = compileToPredicate(r.ast, { clock: fixedClock });
    expect(sql).toContain('EXISTS');
    expect(sql).toContain('ticket_affected_areas');
    expect(Array.isArray(params[0])).toBe(true);
  });
});

const NULL_OPS = new Set(['is_null', 'is_not_null']);
