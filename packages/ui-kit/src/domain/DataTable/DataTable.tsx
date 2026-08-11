/**
 * DataTable — accessible grid component with ARIA sort, roving tabindex,
 * density variants, and controlled external state.
 *
 * - role=grid with column headers (role=columnheader), rows (role=row),
 *   and cells (role=gridcell)
 * - aria-sort on sortable columns
 * - Density: "compact" / "default" / "comfortable"
 * - Loading: renders skeleton rows
 * - Empty: renders empty-state slot
 * - Error: renders error-state slot
 * - Pagination and sorting are controlled externally (no internal state)
 */

import React, { type ReactNode } from 'react';
import { useGridKeyboardNavigation } from './useGridKeyboardNavigation';

export type SortDirection = 'ascending' | 'descending' | 'none';
export type TableDensity = 'compact' | 'default' | 'comfortable';

export interface ColumnDef<T> {
  key: string;
  header: ReactNode;
  /** Render the cell for a row. Receives the row datum. */
  render: (row: T) => ReactNode;
  /** If provided, column header is a sort button. */
  sortable?: boolean;
  /** Width hint (CSS value). */
  width?: string;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  /** Unique key accessor for each row. */
  getRowKey: (row: T, index: number) => string;
  /** Currently sorted column key. */
  sortKey?: string;
  /** Current sort direction. */
  sortDirection?: SortDirection;
  /** Called when a sortable header is clicked. */
  onSort?: (key: string, direction: SortDirection) => void;
  /** Row selection (controlled). */
  selectedRowKeys?: Set<string>;
  onRowSelect?: (key: string, selected: boolean) => void;
  loading?: boolean;
  /** Number of skeleton rows to show while loading. Default: 5. */
  loadingRowCount?: number;
  empty?: ReactNode;
  error?: ReactNode;
  density?: TableDensity;
  className?: string;
  /** aria-label for the grid. */
  ariaLabel?: string;
}

const densityStyles: Record<TableDensity, { cell: React.CSSProperties; header: React.CSSProperties }> = {
  compact:     { cell: { padding: '0.25rem 0.75rem' }, header: { padding: '0.375rem 0.75rem' } },
  default:     { cell: { padding: '0.75rem 1rem'    }, header: { padding: '0.75rem 1rem'     } },
  comfortable: { cell: { padding: '1rem 1.25rem'    }, header: { padding: '1rem 1.25rem'     } },
};

function nextSortDirection(current: SortDirection): SortDirection {
  return current === 'ascending' ? 'descending' : 'ascending';
}

function SkeletonRow({ colCount, density }: { colCount: number; density: TableDensity }) {
  return (
    <tr role="row">
      {Array.from({ length: colCount }, (_, i) => (
        <td
          key={i}
          role="gridcell"
          style={densityStyles[density].cell}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'block',
              height: '0.875rem',
              background: 'var(--color-skeleton, #e5e7eb)',
              borderRadius: '0.25rem',
              width: `${50 + (i * 13) % 40}%`,
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
        </td>
      ))}
    </tr>
  );
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  sortKey,
  sortDirection = 'none',
  onSort,
  selectedRowKeys,
  onRowSelect,
  loading = false,
  loadingRowCount = 5,
  empty,
  error,
  density = 'default',
  className,
  ariaLabel,
}: DataTableProps<T>) {
  const colCount = columns.length;
  const rowCount = rows.length;

  const { getCellTabIndex, handleKeyDown, gridRef, setFocusedCell } =
    useGridKeyboardNavigation({ rowCount, colCount });

  const dStyle = densityStyles[density];

  const handleHeaderSort = (col: ColumnDef<T>) => {
    if (!col.sortable || !onSort) return;
    const newDirection =
      sortKey === col.key ? nextSortDirection(sortDirection) : 'ascending';
    onSort(col.key, newDirection);
  };

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={ariaLabel}
      aria-busy={loading}
      aria-rowcount={loading ? undefined : rowCount}
      data-testid="data-table"
      data-density={density}
      className={className}
      onKeyDown={handleKeyDown}
      style={{ overflowX: 'auto', width: '100%' }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.875rem',
        }}
      >
        <thead>
          <tr role="row">
            {columns.map((col) => {
              const isSorted = col.key === sortKey;
              const ariaSortValue: SortDirection | undefined =
                col.sortable ? (isSorted ? sortDirection : 'none') : undefined;

              return (
                <th
                  key={col.key}
                  role="columnheader"
                  aria-sort={ariaSortValue}
                  style={{
                    ...dStyle.header,
                    textAlign: 'left',
                    fontWeight: 600,
                    borderBottom: '1px solid var(--color-border, #e5e7eb)',
                    width: col.width,
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    cursor: col.sortable ? 'pointer' : 'default',
                  }}
                  onClick={col.sortable ? () => handleHeaderSort(col) : undefined}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    {col.header}
                    {col.sortable && (
                      <span aria-hidden="true" style={{ fontSize: '0.7rem', opacity: isSorted ? 1 : 0.4 }}>
                        {isSorted && sortDirection === 'ascending' ? '↑' :
                         isSorted && sortDirection === 'descending' ? '↓' : '↕'}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {loading ? (
            Array.from({ length: loadingRowCount }, (_, i) => (
              <SkeletonRow key={i} colCount={colCount} density={density} />
            ))
          ) : error ? (
            <tr role="row">
              <td
                role="gridcell"
                colSpan={colCount}
                style={{ ...dStyle.cell, textAlign: 'center' }}
              >
                {error}
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr role="row">
              <td
                role="gridcell"
                colSpan={colCount}
                style={{ ...dStyle.cell, textAlign: 'center', color: 'var(--color-muted, #6b7280)' }}
              >
                {empty ?? 'No data'}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => {
              const rowKey = getRowKey(row, rowIndex);
              const isSelected = selectedRowKeys?.has(rowKey) ?? false;
              return (
                <tr
                  key={rowKey}
                  role="row"
                  aria-selected={selectedRowKeys ? isSelected : undefined}
                  style={{
                    background: isSelected
                      ? 'var(--color-row-selected, #eff6ff)'
                      : 'transparent',
                  }}
                >
                  {columns.map((col, colIndex) => (
                    <td
                      key={col.key}
                      role="gridcell"
                      tabIndex={getCellTabIndex(rowIndex, colIndex)}
                      data-row={rowIndex}
                      data-col={colIndex}
                      onFocus={() => setFocusedCell({ rowIndex, colIndex })}
                      style={{
                        ...dStyle.cell,
                        borderBottom: '1px solid var(--color-border, #e5e7eb)',
                        outline: 'none',
                      }}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
