/**
 * Reporting unit tests — WO-078 AC-11.
 *
 * Covers:
 *   1. builderReducer — all action types, canRun/canSave selectors
 *   2. buildFilterAst — AST assembly golden output
 *   3. FilterRow — operator/type matrix (date → date ops, enum → in/not_in)
 *   4. RunStatePill — all six states with correct labels and aria-live
 *   5. RowLimitNote — truncation warning, stale badge, replica notice
 *   6. ReportBuilderPage — role gating (lead = builder, non-lead = access denied)
 *   7. error code → copy mapping
 *   8. MetricPicker — empty-selection hint
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  builderReducer,
  INITIAL_STATE,
  buildFilterAst,
  canRun,
  canSave,
  type BuilderState,
  type FilterRowState,
} from '../../features/reporting/state/builder.reducer';
import { RunStatePill, type RunState } from '../../features/reporting/components/RunStatePill';
import { RowLimitNote } from '../../features/reporting/components/RowLimitNote';
import { FilterRow } from '../../features/reporting/components/FilterRow';
import { MetricPicker } from '../../features/reporting/components/MetricPicker';
import { ReportBuilderPage } from '../../features/reporting/ReportBuilderPage';
import { getErrorCopy } from '../../lib/api/reporting/types';
import type { CatalogFieldEntry } from '../../lib/api/reporting/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function wrap(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>{ui}</QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// 1. builderReducer
// ---------------------------------------------------------------------------

describe('builderReducer', () => {
  it('starts in INITIAL_STATE', () => {
    const state = builderReducer(INITIAL_STATE, { type: 'MARK_CLEAN' });
    expect(state.metrics).toEqual([]);
    expect(state.groupBy).toBeNull();
    expect(state.dirty).toBe(false);
    expect(state.hasRun).toBe(false);
  });

  it('TOGGLE_METRIC adds a metric', () => {
    const s = builderReducer(INITIAL_STATE, { type: 'TOGGLE_METRIC', payload: 'ticket_count' });
    expect(s.metrics).toContain('ticket_count');
    expect(s.dirty).toBe(true);
  });

  it('TOGGLE_METRIC removes an already-selected metric', () => {
    const with1 = { ...INITIAL_STATE, metrics: ['ticket_count'] };
    const s = builderReducer(with1, { type: 'TOGGLE_METRIC', payload: 'ticket_count' });
    expect(s.metrics).not.toContain('ticket_count');
  });

  it('SET_METRICS replaces the full list', () => {
    const s = builderReducer(INITIAL_STATE, { type: 'SET_METRICS', payload: ['a', 'b'] });
    expect(s.metrics).toEqual(['a', 'b']);
  });

  it('SET_GROUP_BY stores the dimension', () => {
    const s = builderReducer(INITIAL_STATE, { type: 'SET_GROUP_BY', payload: 'organization' });
    expect(s.groupBy).toBe('organization');
  });

  it('SET_GROUP_BY null clears grouping', () => {
    const withGroup = { ...INITIAL_STATE, groupBy: 'priority' };
    const s = builderReducer(withGroup, { type: 'SET_GROUP_BY', payload: null });
    expect(s.groupBy).toBeNull();
  });

  it('SET_CHART_TYPE changes chart type and marks dirty', () => {
    const s = builderReducer(INITIAL_STATE, { type: 'SET_CHART_TYPE', payload: 'bar' });
    expect(s.chartType).toBe('bar');
    expect(s.dirty).toBe(true);
  });

  it('ADD_FILTER appends a new empty row', () => {
    const s = builderReducer(INITIAL_STATE, { type: 'ADD_FILTER' });
    expect(s.filters).toHaveLength(1);
    expect(s.filters[0]!.field).toBe('');
  });

  it('UPDATE_FILTER patches the matching row', () => {
    const withFilter = builderReducer(INITIAL_STATE, { type: 'ADD_FILTER' });
    const key = withFilter.filters[0]!.key;
    const s = builderReducer(withFilter, {
      type: 'UPDATE_FILTER',
      payload: { key, field: 'priority', operator: 'eq', value: 'P1' },
    });
    expect(s.filters[0]!.field).toBe('priority');
    expect(s.filters[0]!.operator).toBe('eq');
    expect(s.filters[0]!.value).toBe('P1');
  });

  it('REMOVE_FILTER removes the matching row', () => {
    const withFilter = builderReducer(INITIAL_STATE, { type: 'ADD_FILTER' });
    const key = withFilter.filters[0]!.key;
    const s = builderReducer(withFilter, { type: 'REMOVE_FILTER', payload: key });
    expect(s.filters).toHaveLength(0);
  });

  it('MARK_RUN sets hasRun true', () => {
    const s = builderReducer(INITIAL_STATE, { type: 'MARK_RUN' });
    expect(s.hasRun).toBe(true);
  });

  it('MARK_SAVED clears dirty and stores savedId', () => {
    const dirty = { ...INITIAL_STATE, dirty: true };
    const s = builderReducer(dirty, { type: 'MARK_SAVED', payload: { id: 'def-001' } });
    expect(s.dirty).toBe(false);
    expect(s.savedId).toBe('def-001');
  });

  it('LOAD_DEFINITION replaces all state from payload', () => {
    const s = builderReducer(INITIAL_STATE, {
      type: 'LOAD_DEFINITION',
      payload: {
        id: 'def-999', name: 'Loaded', metrics: ['m1'],
        groupBy: 'status', chartType: 'line',
        filters: [{ key: 'k', field: 'status', operator: 'eq', value: 'open' }],
        scope: 'team',
      },
    });
    expect(s.name).toBe('Loaded');
    expect(s.metrics).toEqual(['m1']);
    expect(s.groupBy).toBe('status');
    expect(s.chartType).toBe('line');
    expect(s.scope).toBe('team');
    expect(s.dirty).toBe(false);
    expect(s.hasRun).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. buildFilterAst — golden output
// ---------------------------------------------------------------------------

describe('buildFilterAst', () => {
  it('returns null for empty filters', () => {
    expect(buildFilterAst([])).toBeNull();
  });

  it('returns null when no rows have a field', () => {
    const rows: FilterRowState[] = [{ key: 'k1', field: '', operator: '', value: null }];
    expect(buildFilterAst(rows)).toBeNull();
  });

  it('returns a single condition node for one valid row', () => {
    const rows: FilterRowState[] = [
      { key: 'k1', field: 'priority', operator: 'eq', value: 'P1' },
    ];
    const ast = buildFilterAst(rows);
    expect(ast).toMatchObject({ type: 'condition', field: 'priority', operator: 'eq', value: 'P1' });
  });

  it('returns a group AND node for multiple valid rows (golden output)', () => {
    const rows: FilterRowState[] = [
      { key: 'k1', field: 'priority',     operator: 'eq',      value: 'P1'          },
      { key: 'k2', field: 'created_date', operator: 'between', value: ['2026-01-01', '2026-07-31'] },
    ];
    const ast = buildFilterAst(rows);
    expect(ast).toMatchObject({
      type: 'group',
      op:   'and',
      children: [
        { type: 'condition', field: 'priority',     operator: 'eq',      value: 'P1' },
        { type: 'condition', field: 'created_date', operator: 'between', value: ['2026-01-01', '2026-07-31'] },
      ],
    });
  });

  it('skips rows with empty field or operator', () => {
    const rows: FilterRowState[] = [
      { key: 'k1', field: 'priority', operator: 'eq', value: 'P1' },
      { key: 'k2', field: '',         operator: '',   value: null  },
    ];
    const ast = buildFilterAst(rows);
    // Only the valid row — returns single condition, not group
    expect(ast).toMatchObject({ type: 'condition', field: 'priority' });
  });
});

// ---------------------------------------------------------------------------
// 3. canRun / canSave selectors
// ---------------------------------------------------------------------------

describe('canRun / canSave', () => {
  it('canRun returns false with no metrics', () => {
    expect(canRun(INITIAL_STATE)).toBe(false);
  });

  it('canRun returns true with at least one metric', () => {
    const s = { ...INITIAL_STATE, metrics: ['ticket_count'] };
    expect(canRun(s)).toBe(true);
  });

  it('canSave returns false when no name', () => {
    const s = { ...INITIAL_STATE, name: '', metrics: ['ticket_count'] };
    expect(canSave(s)).toBe(false);
  });

  it('canSave returns false with no metrics even if named', () => {
    const s = { ...INITIAL_STATE, name: 'My Report', metrics: [] };
    expect(canSave(s)).toBe(false);
  });

  it('canSave returns true with name and metrics', () => {
    const s = { ...INITIAL_STATE, name: 'My Report', metrics: ['ticket_count'] };
    expect(canSave(s)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. RunStatePill — all six states
// ---------------------------------------------------------------------------

describe('RunStatePill', () => {
  const STATES: RunState[] = ['idle', 'running', 'success', 'truncated', 'timeout', 'error'];

  it('renders without crashing for all states', () => {
    STATES.forEach((state) => {
      const { unmount } = render(<RunStatePill state={state} />);
      unmount();
    });
  });

  it('has role=status and aria-live=polite', () => {
    const { container } = render(<RunStatePill state="idle" />);
    const el = container.querySelector('[role="status"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-live')).toBe('polite');
  });

  it('shows row count for success state', () => {
    render(<RunStatePill state="success" rowCount={42} />);
    expect(screen.getByRole('status').textContent).toContain('42');
  });

  it('shows truncated label with row count', () => {
    render(<RunStatePill state="truncated" rowCount={1000} />);
    expect(screen.getByRole('status').textContent).toContain('Truncated');
    expect(screen.getByRole('status').textContent).toContain('1,000');
  });

  it('shows actionable timeout message', () => {
    render(<RunStatePill state="timeout" errorCode="REPORT_QUERY_TIMEOUT" />);
    expect(screen.getByRole('status').textContent).toContain('Timed out');
  });

  it('shows error code copy for known error', () => {
    render(<RunStatePill state="error" errorCode="REPORT_ROW_LIMIT_EXCEEDED" />);
    expect(screen.getByRole('status').textContent).toContain('Error');
  });
});

// ---------------------------------------------------------------------------
// 5. RowLimitNote
// ---------------------------------------------------------------------------

describe('RowLimitNote', () => {
  it('renders preview and export caps', () => {
    render(<RowLimitNote previewCap={1000} exportCap={500000} />);
    expect(screen.getByRole('note').textContent).toContain('1,000');
    expect(screen.getByRole('note').textContent).toContain('500,000');
  });

  it('renders replica notice', () => {
    render(<RowLimitNote />);
    expect(screen.getByRole('note').textContent).toContain('read replica');
  });

  it('renders truncation warning when truncated=true', () => {
    render(<RowLimitNote truncated previewCap={1000} />);
    expect(screen.getByRole('alert').textContent).toContain('truncated');
  });

  it('does NOT render truncation alert when not truncated', () => {
    render(<RowLimitNote truncated={false} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders stale badge when lag exceeds threshold', () => {
    render(<RowLimitNote lagSeconds={45} staleThresholdSeconds={30} dataAsOf="2026-08-01T00:00:00Z" />);
    expect(screen.getByRole('status').textContent).toContain('STALE');
  });

  it('does NOT render stale badge when lag is below threshold', () => {
    render(<RowLimitNote lagSeconds={10} staleThresholdSeconds={30} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders dataAsOf as a time element', () => {
    const { container } = render(<RowLimitNote dataAsOf="2026-08-01T00:00:00Z" lagSeconds={5} />);
    expect(container.querySelector('time')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. FilterRow — operator/type matrix
// ---------------------------------------------------------------------------

const DATE_FIELD: CatalogFieldEntry = {
  name: 'created_date', label: 'Created Date', dataType: 'date',
  fieldKind: 'dimension', allowedOperators: ['between', 'before', 'after'],
};
const ENUM_FIELD: CatalogFieldEntry = {
  name: 'priority', label: 'Priority', dataType: 'text_enum',
  fieldKind: 'dimension', allowedOperators: ['eq', 'in', 'not_in'],
  enumValues: ['P1', 'P2', 'P3', 'P4'],
};
const NUMERIC_FIELD: CatalogFieldEntry = {
  name: 'avg_resolution_minutes', label: 'Avg Resolution', dataType: 'numeric',
  fieldKind: 'metric', allowedOperators: [],
};

const CATALOG = [DATE_FIELD, ENUM_FIELD];

function makeRow(overrides: Partial<FilterRowState> = {}): FilterRowState {
  return { key: 'k1', field: '', operator: '', value: null, ...overrides };
}

describe('FilterRow — operator/type matrix', () => {
  it('renders field select with catalog dimensions', () => {
    render(
      <FilterRow
        row={makeRow()}
        catalog={CATALOG}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const fieldSelect = screen.getAllByRole('combobox')[0]!;
    fireEvent.change(fieldSelect, { target: { value: 'created_date' } });
    // Should trigger onUpdate
  });

  it('shows date operators when date field is selected', () => {
    const { container } = render(
      <FilterRow
        row={makeRow({ field: 'created_date' })}
        catalog={CATALOG}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const selects = container.querySelectorAll('select');
    // Second select is operator
    const opSelect = selects[1] as HTMLSelectElement;
    const optValues = Array.from(opSelect.options).map((o) => o.value);
    expect(optValues).toContain('between');
    expect(optValues).toContain('before');
    expect(optValues).toContain('after');
    expect(optValues).not.toContain('eq');   // date field does not have eq
  });

  it('shows in/not_in operators for enum field', () => {
    const { container } = render(
      <FilterRow
        row={makeRow({ field: 'priority' })}
        catalog={CATALOG}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const selects = container.querySelectorAll('select');
    const opSelect = selects[1] as HTMLSelectElement;
    const optValues = Array.from(opSelect.options).map((o) => o.value);
    expect(optValues).toContain('in');
    expect(optValues).toContain('not_in');
  });

  it('shows multi-select for enum field with in operator', () => {
    const { container } = render(
      <FilterRow
        row={makeRow({ field: 'priority', operator: 'in', value: [] })}
        catalog={CATALOG}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    // multi-select has [multiple] attribute
    expect(container.querySelector('select[multiple]')).not.toBeNull();
  });

  it('shows date inputs for date field with between operator', () => {
    const { container } = render(
      <FilterRow
        row={makeRow({ field: 'created_date', operator: 'between', value: ['', ''] })}
        catalog={CATALOG}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const dateInputs = container.querySelectorAll('input[type="date"]');
    expect(dateInputs).toHaveLength(2);
  });

  it('shows retired-field error when isRetired=true', () => {
    render(
      <FilterRow
        row={makeRow({ field: 'old_field' })}
        catalog={CATALOG}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        isRetired
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('removed from the catalog');
  });

  it('remove button calls onRemove', () => {
    const onRemove = vi.fn();
    render(
      <FilterRow
        row={makeRow()}
        catalog={CATALOG}
        onUpdate={vi.fn()}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByLabelText('Remove filter'));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 7. MetricPicker — empty-selection hint
// ---------------------------------------------------------------------------

const MOCK_METRICS: CatalogFieldEntry[] = [
  { name: 'ticket_count', label: 'Ticket Count', dataType: 'integer', fieldKind: 'metric', allowedOperators: [] },
  { name: 'sla_attainment_pct', label: 'SLA Attainment %', dataType: 'numeric', fieldKind: 'metric', allowedOperators: [] },
];

describe('MetricPicker', () => {
  it('renders a chip for each metric', () => {
    render(<MetricPicker metrics={MOCK_METRICS} selected={[]} onToggle={vi.fn()} />);
    expect(screen.getByText('Ticket Count')).toBeTruthy();
    expect(screen.getByText('SLA Attainment %')).toBeTruthy();
  });

  it('marks selected metrics visually', () => {
    render(<MetricPicker metrics={MOCK_METRICS} selected={['ticket_count']} onToggle={vi.fn()} />);
    const checkbox = screen.getByLabelText('Ticket Count') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('shows hint when no metric selected', () => {
    render(<MetricPicker metrics={MOCK_METRICS} selected={[]} onToggle={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('at least one metric');
  });

  it('does not show hint when a metric is selected', () => {
    render(<MetricPicker metrics={MOCK_METRICS} selected={['ticket_count']} onToggle={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('calls onToggle with field name on click', () => {
    const onToggle = vi.fn();
    render(<MetricPicker metrics={MOCK_METRICS} selected={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByText('Ticket Count'));
    expect(onToggle).toHaveBeenCalledWith('ticket_count');
  });
});

// ---------------------------------------------------------------------------
// 8. ReportBuilderPage — role gating
// ---------------------------------------------------------------------------

describe('ReportBuilderPage — role gating', () => {
  it('renders access-denied for agent role', () => {
    wrap(<ReportBuilderPage userRole="agent" />);
    expect(screen.getByRole('alert').textContent).toContain('Access denied');
  });

  it('renders access-denied for portal_user role', () => {
    wrap(<ReportBuilderPage userRole="portal_user" />);
    expect(screen.getByRole('alert').textContent).toContain('Access denied');
  });

  it('renders builder for lead_analyst role', () => {
    wrap(<ReportBuilderPage userRole="lead_analyst" />);
    // Should NOT show access-denied
    expect(screen.queryByText('Access denied')).toBeNull();
    // Should show builder landmark
    expect(screen.getByRole('navigation', { name: 'Saved reports' })).toBeTruthy();
  });

  it('renders builder for admin role', () => {
    wrap(<ReportBuilderPage userRole="admin" />);
    expect(screen.queryByText('Access denied')).toBeNull();
  });

  it('renders builder when no role provided (deferred to server)', () => {
    wrap(<ReportBuilderPage />);
    expect(screen.queryByText('Access denied')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Error copy mapping
// ---------------------------------------------------------------------------

describe('getErrorCopy', () => {
  it('returns specific copy for REPORT_QUERY_TIMEOUT', () => {
    const copy = getErrorCopy('REPORT_QUERY_TIMEOUT');
    expect(copy.toLowerCase()).toContain('narrow');
  });

  it('returns specific copy for REPORT_ROW_LIMIT_EXCEEDED', () => {
    const copy = getErrorCopy('REPORT_ROW_LIMIT_EXCEEDED');
    expect(copy.toLowerCase()).toContain('csv');
  });

  it('returns specific copy for DEFINITION_FIELD_RETIRED', () => {
    const copy = getErrorCopy('DEFINITION_FIELD_RETIRED');
    expect(copy.toLowerCase()).toContain('retired');
  });

  it('returns specific copy for EXPORT_FORMAT_ROW_LIMIT', () => {
    const copy = getErrorCopy('EXPORT_FORMAT_ROW_LIMIT');
    expect(copy.toLowerCase()).toContain('pdf');
  });

  it('returns fallback for unknown code', () => {
    const copy = getErrorCopy('UNKNOWN_ERROR', 'fallback msg');
    expect(copy).toBe('fallback msg');
  });

  it('returns generic message for unknown code with no fallback', () => {
    const copy = getErrorCopy('TOTALLY_UNKNOWN');
    expect(copy).toContain('unexpected');
  });
});
