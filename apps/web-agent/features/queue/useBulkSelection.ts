/**
 * useBulkSelection — reducer-based multi-row selection for the ticket table.
 *
 * Supports:
 *   - Individual row toggle
 *   - Select-all-on-page
 *   - Shift+click range selection (Shift and Select between anchor and target)
 *   - Clear all
 *
 * The reducer is a pure function so it is fully unit-testable.
 */

import { useReducer, useCallback } from 'react';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface BulkSelectionState {
  /** Ordered list of all row IDs on the current page (used for range). */
  pageIds: string[];
  /** Set of currently selected IDs. */
  selected: ReadonlySet<string>;
  /** Anchor index for shift+click range selection. */
  anchorIdx: number | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type BulkSelectionAction =
  | { type: 'SET_PAGE'; pageIds: string[] }
  | { type: 'TOGGLE'; id: string; idx: number }
  | { type: 'RANGE_TO'; toIdx: number }
  | { type: 'SELECT_ALL' }
  | { type: 'CLEAR' };

// ---------------------------------------------------------------------------
// Reducer (pure function)
// ---------------------------------------------------------------------------

export function bulkSelectionReducer(
  state: BulkSelectionState,
  action: BulkSelectionAction,
): BulkSelectionState {
  switch (action.type) {
    case 'SET_PAGE': {
      // When page IDs change (new view/filter), preserve selection intersection
      const nextSelected = new Set(
        action.pageIds.filter((id) => state.selected.has(id)),
      );
      return { pageIds: action.pageIds, selected: nextSelected, anchorIdx: null };
    }

    case 'TOGGLE': {
      const next = new Set(state.selected);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      return { ...state, selected: next, anchorIdx: action.idx };
    }

    case 'RANGE_TO': {
      if (state.anchorIdx === null) return state;
      const from = Math.min(state.anchorIdx, action.toIdx);
      const to = Math.max(state.anchorIdx, action.toIdx);
      const next = new Set(state.selected);
      for (let i = from; i <= to; i++) {
        const id = state.pageIds[i];
        if (id) next.add(id);
      }
      return { ...state, selected: next };
    }

    case 'SELECT_ALL': {
      const next = new Set(state.pageIds);
      return { ...state, selected: next, anchorIdx: 0 };
    }

    case 'CLEAR': {
      return { ...state, selected: new Set(), anchorIdx: null };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const INITIAL_STATE: BulkSelectionState = {
  pageIds: [],
  selected: new Set(),
  anchorIdx: null,
};

export function useBulkSelection() {
  const [state, dispatch] = useReducer(bulkSelectionReducer, INITIAL_STATE);

  const setPage = useCallback((pageIds: string[]) => {
    dispatch({ type: 'SET_PAGE', pageIds });
  }, []);

  const toggle = useCallback((id: string, idx: number, shift = false) => {
    if (shift) {
      dispatch({ type: 'RANGE_TO', toIdx: idx });
    } else {
      dispatch({ type: 'TOGGLE', id, idx });
    }
  }, []);

  const selectAll = useCallback(() => dispatch({ type: 'SELECT_ALL' }), []);
  const clear = useCallback(() => dispatch({ type: 'CLEAR' }), []);

  const isAllSelected =
    state.pageIds.length > 0 && state.pageIds.every((id) => state.selected.has(id));

  const isIndeterminate =
    !isAllSelected && state.selected.size > 0 && state.pageIds.some((id) => state.selected.has(id));

  return {
    selected: state.selected,
    selectedIds: Array.from(state.selected),
    selectedCount: state.selected.size,
    isAllSelected,
    isIndeterminate,
    setPage,
    toggle,
    selectAll,
    clear,
  };
}
