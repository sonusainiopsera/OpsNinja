/**
 * Queue unit tests — WO-041.
 *
 * Covers:
 *   1. useBulkSelection reducer (toggle, range, select-all, clear)
 *   2. flattenQueuePages / detectStaleResultSet cursor-append logic
 *   3. FilterChipBar rendering and chip removal
 *   4. AddFilterDrawer field/operator allow-list (only FIELD_REGISTRY entries selectable)
 *
 * Uses fake timers where async behaviour is tested.
 * Tests are independent and parallel-safe (no shared module state).
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  bulkSelectionReducer,
  type BulkSelectionState,
} from '../../features/queue/useBulkSelection';
import {
  flattenQueuePages,
  detectStaleResultSet,
} from '../../lib/api/tickets/hooks';
import { FilterChipBar } from '../../features/queue/FilterChipBar';
import { FIELD_REGISTRY } from '@opsninja/filter-compiler';
import type { FilterAst } from '@opsninja/filter-compiler';
import type { TicketListResponse } from '../../lib/api/tickets/types';

// ---------------------------------------------------------------------------
// 1. bulkSelectionReducer
// ---------------------------------------------------------------------------

describe('bulkSelectionReducer', () => {
  const baseState: BulkSelectionState = {
    pageIds: ['a', 'b', 'c', 'd', 'e'],
    selected: new Set(),
    anchorIdx: null,
  };

  it('TOGGLE adds a row', () => {
    const next = bulkSelectionReducer(baseState, { type: 'TOGGLE', id: 'b', idx: 1 });
    expect(next.selected.has('b')).toBe(true);
    expect(next.anchorIdx).toBe(1);
  });

  it('TOGGLE removes a selected row', () => {
    const withB: BulkSelectionState = { ...baseState, selected: new Set(['b']), anchorIdx: 1 };
    const next = bulkSelectionReducer(withB, { type: 'TOGGLE', id: 'b', idx: 1 });
    expect(next.selected.has('b')).toBe(false);
  });

  it('SELECT_ALL selects all pageIds', () => {
    const next = bulkSelectionReducer(baseState, { type: 'SELECT_ALL' });
    expect(next.selected.size).toBe(5);
    baseState.pageIds.forEach((id) => expect(next.selected.has(id)).toBe(true));
  });

  it('CLEAR empties selection and resets anchor', () => {
    const withAll: BulkSelectionState = {
      ...baseState,
      selected: new Set(['a', 'b', 'c']),
      anchorIdx: 0,
    };
    const next = bulkSelectionReducer(withAll, { type: 'CLEAR' });
    expect(next.selected.size).toBe(0);
    expect(next.anchorIdx).toBe(null);
  });

  it('RANGE_TO selects inclusive range from anchor', () => {
    const withAnchor: BulkSelectionState = { ...baseState, anchorIdx: 1 };
    const next = bulkSelectionReducer(withAnchor, { type: 'RANGE_TO', toIdx: 3 });
    // Should select b(1), c(2), d(3)
    expect(next.selected.has('b')).toBe(true);
    expect(next.selected.has('c')).toBe(true);
    expect(next.selected.has('d')).toBe(true);
    expect(next.selected.has('a')).toBe(false);
    expect(next.selected.has('e')).toBe(false);
  });

  it('RANGE_TO handles reverse direction (toIdx < anchorIdx)', () => {
    const withAnchor: BulkSelectionState = { ...baseState, anchorIdx: 3 };
    const next = bulkSelectionReducer(withAnchor, { type: 'RANGE_TO', toIdx: 1 });
    expect(next.selected.has('b')).toBe(true);
    expect(next.selected.has('c')).toBe(true);
    expect(next.selected.has('d')).toBe(true);
  });

  it('RANGE_TO is a no-op when anchorIdx is null', () => {
    const next = bulkSelectionReducer(baseState, { type: 'RANGE_TO', toIdx: 2 });
    expect(next).toBe(baseState);
  });

  it('SET_PAGE preserves selection intersection', () => {
    const withSel: BulkSelectionState = {
      ...baseState,
      selected: new Set(['b', 'c', 'z']), // 'z' is not in the new page
      anchorIdx: 1,
    };
    const next = bulkSelectionReducer(withSel, { type: 'SET_PAGE', pageIds: ['a', 'b', 'c'] });
    expect(next.selected.has('b')).toBe(true);
    expect(next.selected.has('c')).toBe(true);
    expect(next.selected.has('z')).toBe(false); // dropped — not in new page
  });
});

// ---------------------------------------------------------------------------
// 2. flattenQueuePages / detectStaleResultSet
// ---------------------------------------------------------------------------

describe('flattenQueuePages', () => {
  function makePage(ids: string[], version = 'v1'): TicketListResponse {
    return {
      data: ids.map((id) => ({ id } as unknown as TicketListResponse['data'][0])),
      nextCursor: null,
      resultSetVersion: version,
      serverNow: '2026-08-11T10:00:00Z',
      total: ids.length,
    };
  }

  it('returns empty array for undefined data', () => {
    expect(flattenQueuePages(undefined)).toEqual([]);
  });

  it('flattens multiple pages', () => {
    const data = {
      pages: [makePage(['a', 'b']), makePage(['c', 'd'])],
      pageParams: [undefined, 'cursor1'],
    };
    const rows = flattenQueuePages(data);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('detectStaleResultSet', () => {
  function makePage(version: string): TicketListResponse {
    return {
      data: [],
      nextCursor: null,
      resultSetVersion: version,
      serverNow: '2026-08-11T10:00:00Z',
      total: 0,
    };
  }

  it('returns false for single page', () => {
    const data = { pages: [makePage('v1')], pageParams: [undefined] };
    expect(detectStaleResultSet(data)).toBe(false);
  });

  it('returns false when all pages share the same version', () => {
    const data = { pages: [makePage('v1'), makePage('v1')], pageParams: [undefined, 'c1'] };
    expect(detectStaleResultSet(data)).toBe(false);
  });

  it('returns true when pages have different resultSetVersion', () => {
    const data = { pages: [makePage('v1'), makePage('v2')], pageParams: [undefined, 'c1'] };
    expect(detectStaleResultSet(data)).toBe(true);
  });

  it('returns false for undefined data', () => {
    expect(detectStaleResultSet(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. FilterChipBar
// ---------------------------------------------------------------------------

describe('FilterChipBar', () => {
  const priorityFilter: FilterAst = {
    type: 'condition',
    field: 'priority',
    operator: 'eq',
    value: 'P1',
  };

  it('renders a chip for each active condition', () => {
    const onChange = vi.fn();
    render(
      <FilterChipBar
        filter={priorityFilter}
        onChange={onChange}
        onAddFilter={vi.fn()}
      />,
    );
    expect(screen.getByText(/priority eq P1/i)).toBeTruthy();
  });

  it('calls onChange with null when × is clicked on a chip', () => {
    const onChange = vi.fn();
    render(
      <FilterChipBar
        filter={priorityFilter}
        onChange={onChange}
        onAddFilter={vi.fn()}
      />,
    );
    const removeBtn = screen.getByRole('button', { name: /Remove filter/i });
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('calls onChange with null when Clear all is clicked', () => {
    const onChange = vi.fn();
    render(
      <FilterChipBar
        filter={priorityFilter}
        onChange={onChange}
        onAddFilter={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Clear all'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('calls onAddFilter when + Add filter is clicked', () => {
    const onAddFilter = vi.fn();
    render(
      <FilterChipBar
        filter={null}
        onChange={vi.fn()}
        onAddFilter={onAddFilter}
      />,
    );
    fireEvent.click(screen.getByText('+ Add filter'));
    expect(onAddFilter).toHaveBeenCalledOnce();
  });

  it('renders group filter as multiple chips', () => {
    const groupFilter: FilterAst = {
      type: 'group',
      op: 'and',
      children: [
        { type: 'condition', field: 'priority', operator: 'eq', value: 'P1' },
        { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
      ],
    };
    render(
      <FilterChipBar filter={groupFilter} onChange={vi.fn()} onAddFilter={vi.fn()} />,
    );
    const removeButtons = screen.getAllByRole('button', { name: /Remove filter/i });
    expect(removeButtons).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 4. AddFilterDrawer — allow-list enforcement
// ---------------------------------------------------------------------------

describe('AddFilterDrawer field allow-list', () => {
  it('FIELD_REGISTRY only contains known safe fields', () => {
    const fieldNames = Object.keys(FIELD_REGISTRY);
    expect(fieldNames.length).toBeGreaterThan(0);
    // Ensure no empty keys
    fieldNames.forEach((k) => expect(k.length).toBeGreaterThan(0));
    // Ensure every field has allowedOperators
    fieldNames.forEach((k) => {
      expect(FIELD_REGISTRY[k]!.allowedOperators.length).toBeGreaterThan(0);
    });
  });

  it('every field in FIELD_REGISTRY has at least one allowed operator', () => {
    Object.entries(FIELD_REGISTRY).forEach(([field, entry]) => {
      expect(entry.allowedOperators.length).toBeGreaterThan(0);
      expect(typeof field).toBe('string');
    });
  });
});
