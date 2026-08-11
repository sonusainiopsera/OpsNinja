'use client';

/**
 * builder.reducer.ts — reducer-backed state for the Report Builder (WO-078).
 *
 * State shape:
 *   metrics    — selected metric field names
 *   groupBy    — single dimension field name (null = no grouping)
 *   chartType  — 'table' | 'bar' | 'line'
 *   filters    — array of ConditionNode filter rows (assembled into FilterAst on run)
 *   dirty      — true when state has changed since last save
 *   name       — current definition name
 *   savedId    — id of the saved definition (null for unsaved)
 *   scope      — sharing scope
 *   hasRun     — true once the user has explicitly run the report (prevents auto-run)
 */

import type { ChartType, FilterAst, ReportScope } from '../../../lib/api/reporting/types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface FilterRowState {
  /** Unique local key for React reconciliation */
  key: string;
  field: string;
  operator: string;
  value: unknown;
}

export interface BuilderState {
  metrics:   string[];
  groupBy:   string | null;
  chartType: ChartType;
  filters:   FilterRowState[];
  dirty:     boolean;
  name:      string;
  savedId:   string | null;
  scope:     ReportScope;
  hasRun:    boolean;
}

export const INITIAL_STATE: BuilderState = {
  metrics:   [],
  groupBy:   null,
  chartType: 'table',
  filters:   [],
  dirty:     false,
  name:      'Untitled Report',
  savedId:   null,
  scope:     'private',
  hasRun:    false,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type BuilderAction =
  | { type: 'SET_METRICS';    payload: string[] }
  | { type: 'TOGGLE_METRIC';  payload: string }
  | { type: 'SET_GROUP_BY';   payload: string | null }
  | { type: 'SET_CHART_TYPE'; payload: ChartType }
  | { type: 'ADD_FILTER' }
  | { type: 'UPDATE_FILTER';  payload: { key: string } & Partial<Omit<FilterRowState, 'key'>> }
  | { type: 'REMOVE_FILTER';  payload: string }          // key
  | { type: 'CLEAR_FILTERS' }
  | { type: 'MARK_RUN' }
  | { type: 'SET_NAME';       payload: string }
  | { type: 'SET_SCOPE';      payload: ReportScope }
  | { type: 'LOAD_DEFINITION'; payload: LoadDefinitionPayload }
  | { type: 'MARK_SAVED';     payload: { id: string } }
  | { type: 'MARK_CLEAN' };

export interface LoadDefinitionPayload {
  id:        string;
  name:      string;
  metrics:   string[];
  groupBy:   string | null;
  chartType: ChartType;
  filters:   FilterRowState[];
  scope:     ReportScope;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

let filterKeyCounter = 0;
function nextKey(): string {
  return `fk-${++filterKeyCounter}`;
}

export function builderReducer(
  state: BuilderState,
  action: BuilderAction,
): BuilderState {
  switch (action.type) {
    case 'SET_METRICS':
      return { ...state, metrics: action.payload, dirty: true };

    case 'TOGGLE_METRIC': {
      const exists = state.metrics.includes(action.payload);
      return {
        ...state,
        metrics: exists
          ? state.metrics.filter((m) => m !== action.payload)
          : [...state.metrics, action.payload],
        dirty: true,
      };
    }

    case 'SET_GROUP_BY':
      return { ...state, groupBy: action.payload, dirty: true };

    case 'SET_CHART_TYPE':
      return { ...state, chartType: action.payload, dirty: true };

    case 'ADD_FILTER':
      return {
        ...state,
        filters: [...state.filters, { key: nextKey(), field: '', operator: '', value: null }],
        dirty: true,
      };

    case 'UPDATE_FILTER':
      return {
        ...state,
        filters: state.filters.map((f) =>
          f.key === action.payload.key ? { ...f, ...action.payload } : f,
        ),
        dirty: true,
      };

    case 'REMOVE_FILTER':
      return {
        ...state,
        filters: state.filters.filter((f) => f.key !== action.payload),
        dirty: true,
      };

    case 'CLEAR_FILTERS':
      return { ...state, filters: [], dirty: true };

    case 'MARK_RUN':
      return { ...state, hasRun: true };

    case 'SET_NAME':
      return { ...state, name: action.payload, dirty: true };

    case 'SET_SCOPE':
      return { ...state, scope: action.payload, dirty: true };

    case 'LOAD_DEFINITION':
      return {
        ...state,
        savedId:   action.payload.id,
        name:      action.payload.name,
        metrics:   action.payload.metrics,
        groupBy:   action.payload.groupBy,
        chartType: action.payload.chartType,
        filters:   action.payload.filters.map((f) => ({ ...f, key: nextKey() })),
        scope:     action.payload.scope,
        dirty:     false,
        hasRun:    false,
      };

    case 'MARK_SAVED':
      return { ...state, savedId: action.payload.id, dirty: false };

    case 'MARK_CLEAN':
      return { ...state, dirty: false };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Selectors / helpers
// ---------------------------------------------------------------------------

/**
 * Assemble a flat-AND FilterAst from the builder's filter rows.
 * Rows with an empty field or operator are skipped.
 * Returns null when no valid rows exist.
 */
export function buildFilterAst(filters: FilterRowState[]): FilterAst {
  const valid = filters.filter((f) => f.field && f.operator);
  if (valid.length === 0) return null;
  if (valid.length === 1) {
    return { type: 'condition', field: valid[0]!.field, operator: valid[0]!.operator, value: valid[0]!.value };
  }
  return {
    type: 'group',
    op: 'and',
    children: valid.map((f) => ({
      type: 'condition',
      field: f.field,
      operator: f.operator,
      value: f.value,
    })),
  };
}

/** True when the definition is ready to run (at least one metric, not empty). */
export function canRun(state: BuilderState): boolean {
  return state.metrics.length > 0;
}

/** True when the definition is ready to save (has a non-empty name and ≥1 metric). */
export function canSave(state: BuilderState): boolean {
  return state.name.trim().length > 0 && state.metrics.length > 0;
}
