/**
 * DataTable — accessible, sortable, keyboard-navigable data grid.
 *
 * Implements WAI-ARIA grid pattern:
 *  - role="grid" on table
 *  - role="row" on rows
 *  - role="columnheader" + aria-sort on header cells
 *  - role="gridcell" on body cells
 *  - Roving tabindex via useGridKeyboardNavigation
 *
 * Features: sorting, row selection, sticky header, striped rows,
 * density variants, loading/empty/error states, custom cell renderers.
 */

import React, { useCallback, useState } from 'react';
import { useGridKeyboardNavigation } from './useGridKeyboardNavigation';

export type SortDirection = 'asc' | 'desc' | 'none';
export type Density = 'comfortable' | 'compact';

export interface ColumnDef<T> {
  id: string;
  header: React.ReactNode;
  /** Extract a cell value from the row datum. */
  accessor: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Column width, CSS value (e.g. '120px', '1fr'). */
  width?: string;
  /** Override the default cell renderer entirely. */
  cell?: (row: T, rowIndex: number) => React.ReactNode;
}

export interface SortState {
  columnId: string;
  direction: SortDirection;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  /** Key extractor for row identity and aria attributes. */
  getRowId: (row: T) => string;
  /** External sort state (controlled). When provided, sorting is controlled. */
  sortState?: SortState;
  /** Called when user requests a sort change. */
  onSortChange?: (next: SortState) => void;
  /** Row selection: set of selected row IDs (controlled). */
  selectedRowIds?: Set<string>;
  /** Called when a row is selected/deselected. */
  onRowSelect?: (rowId: string, selected: boolean) => void;
  density?: Density;
  /** Show striped row background. Default true. */
  striped?: boolean;
  /** Sticky header. Default true. */
  stickyHeader?: boolean;
  loading?: boolean;
  /** Show this content when data is empty and not loading/error. */
  emptyContent?: React.ReactNode;
  error?: string | null;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

const CELL_PADDING: Record<Density, string> = {
  comfortable: '12px 16px',
  compact: '6px 10px',
};

function nextSortDirection(current: SortDirection): SortDirection {
  if (current === 'none' || current === 'desc') return 'asc';
  return 'desc';
}

function ariaSort(dir: SortDirection): React.AriaAttributes['aria-sort'] {
  if (dir === 'asc') return 'ascending';
  if (dir === 'desc') return 'descending';
  return 'none';
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  sortState,
  onSortChange,
  selectedRowIds,
  onRowSelect,
  density = 'comfortable',
  striped = true,
  stickyHeader = true,
  loading = false,
  emptyContent,
  error,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: DataTableProps<T>) {
  const [internalSort, setInternalSort] = useState<SortState | null>(null);

  const effectiveSort = sortState ?? internalSort;

  const handleHeaderClick = useCallback(
    (col: ColumnDef<T>) => {
      if (!col.sortable) return;
      const currentDir: SortDirection =
        effectiveSort?.columnId === col.id ? effectiveSort.direction : 'none';
      const next: SortState = { columnId: col.id, direction: nextSortDirection(currentDir) };
      if (onSortChange) {
        onSortChange(next);
      } else {
        setInternalSort(next);
      }
    },
    [effectiveSort, onSortChange],
  );

  const rowCount = data.length;
  const colCount = columns.length + (onRowSelect ? 1 : 0);

  const nav = useGridKeyboardNavigation(loading || error ? 0 : rowCount, colCount);

  const cellPadding = CELL_PADDING[density];

  const headerStyle: React.CSSProperties = {
    padding: cellPadding,
    background: 'var(--dt-header-bg, #f9fafb)',
    color: 'var(--dt-header-fg, #374151)',
    fontWeight: 600,
    fontSize: 12,
    textAlign: 'left',
    borderBottom: '2px solid var(--dt-border, #e5e7eb)',
    position: stickyHeader ? 'sticky' : undefined,
    top: stickyHeader ? 0 : undefined,
    zIndex: stickyHeader ? 1 : undefined,
    whiteSpace: 'nowrap',
    userSelect: 'none',
  };

  const cellStyle = (align?: string): React.CSSProperties => ({
    padding: cellPadding,
    fontSize: 13,
    borderBottom: '1px solid var(--dt-border, #e5e7eb)',
    textAlign: (align as React.CSSProperties['textAlign']) ?? 'left',
    color: 'var(--dt-cell-fg, #111827)',
  });

  const rowStyle = (idx: number, id: string): React.CSSProperties => ({
    background: selectedRowIds?.has(id)
      ? 'var(--dt-row-selected-bg, #eff6ff)'
      : striped && idx % 2 === 1
        ? 'var(--dt-row-alt-bg, #f9fafb)'
        : 'var(--dt-row-bg, #fff)',
    cursor: onRowSelect ? 'pointer' : undefined,
  });

  if (error) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{ padding: 16, color: 'var(--dt-error-fg, #991b1b)', fontSize: 13 }}
      >
        {error}
      </div>
    );
  }

  const isEmpty = !loading && data.length === 0;

  return (
    <div style={{ overflowX: 'auto' }} className={className}>
      <table
        ref={nav.gridRef}
        role="grid"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-busy={loading || undefined}
        aria-rowcount={loading ? undefined : rowCount}
        onKeyDown={nav.handleKeyDown}
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: 'fixed',
        }}
      >
        <colgroup>
          {onRowSelect && <col style={{ width: 40 }} />}
          {columns.map((col) => (
            <col key={col.id} style={{ width: col.width }} />
          ))}
        </colgroup>
        <thead>
          <tr role="row">
            {onRowSelect && (
              <th
                role="columnheader"
                scope="col"
                style={{ ...headerStyle, width: 40 }}
                aria-label="Row selection"
              />
            )}
            {columns.map((col, ci) => {
              const colOffset = onRowSelect ? ci + 1 : ci;
              const isSorted = effectiveSort?.columnId === col.id;
              const dir: SortDirection = isSorted ? effectiveSort!.direction : 'none';
              return (
                <th
                  key={col.id}
                  role="columnheader"
                  scope="col"
                  aria-sort={col.sortable ? ariaSort(dir) : undefined}
                  data-col-index={colOffset}
                  data-row-index={-1}
                  tabIndex={nav.getCellTabIndex(-1, colOffset)}
                  style={{
                    ...headerStyle,
                    cursor: col.sortable ? 'pointer' : 'default',
                    textAlign: col.align ?? 'left',
                  }}
                  onClick={() => handleHeaderClick(col)}
                  onKeyDown={(e) => {
                    if (col.sortable && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      handleHeaderClick(col);
                    }
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {col.header}
                    {col.sortable && (
                      <span
                        aria-hidden="true"
                        style={{ fontSize: 10, opacity: isSorted ? 1 : 0.35 }}
                      >
                        {dir === 'desc' ? '▼' : '▲'}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr role="row">
              <td
                role="gridcell"
                colSpan={colCount}
                style={{ textAlign: 'center', padding: 24, color: 'var(--dt-muted, #6b7280)', fontSize: 13 }}
                aria-label="Loading"
              >
                Loading…
              </td>
            </tr>
          )}
          {isEmpty && !loading && (
            <tr role="row">
              <td
                role="gridcell"
                colSpan={colCount}
                style={{ textAlign: 'center', padding: 24, color: 'var(--dt-muted, #6b7280)', fontSize: 13 }}
              >
                {emptyContent ?? 'No data'}
              </td>
            </tr>
          )}
          {!loading &&
            data.map((row, ri) => {
              const id = getRowId(row);
              const isSelected = selectedRowIds?.has(id) ?? false;
              return (
                <tr
                  key={id}
                  role="row"
                  data-row-index={ri}
                  aria-selected={onRowSelect ? isSelected : undefined}
                  style={rowStyle(ri, id)}
                  onClick={() => onRowSelect?.(id, !isSelected)}
                >
                  {onRowSelect && (
                    <td
                      role="gridcell"
                      data-col-index={0}
                      data-row-index={ri}
                      tabIndex={nav.getCellTabIndex(ri, 0)}
                      style={cellStyle('center')}
                      onClick={(e) => {
                        e.stopPropagation();
                        nav.handleCellClick(ri, 0);
                        onRowSelect(id, !isSelected);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onRowSelect(id, !isSelected)}
                        aria-label={`Select row ${id}`}
                        tabIndex={-1}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                  )}
                  {columns.map((col, ci) => {
                    const colOffset = onRowSelect ? ci + 1 : ci;
                    return (
                      <td
                        key={col.id}
                        role="gridcell"
                        data-col-index={colOffset}
                        data-row-index={ri}
                        tabIndex={nav.getCellTabIndex(ri, colOffset)}
                        style={cellStyle(col.align)}
                        onClick={() => nav.handleCellClick(ri, colOffset)}
                      >
                        {col.cell ? col.cell(row, ri) : col.accessor(row)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
