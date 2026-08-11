/**
 * useGridKeyboardNavigation — roving tabindex for role=grid.
 *
 * Implements the ARIA grid keyboard pattern:
 *   Arrow keys   — move focus one cell in that direction
 *   Home / End   — move to first / last cell in current row
 *   Ctrl+Home    — move to first cell of first row
 *   Ctrl+End     — move to last cell of last row
 *   PageUp/Down  — move focus up/down by pageSize rows (default 10)
 *   Enter/Space  — fire onActivate for the focused cell
 *
 * The hook manages focusedCell state and returns a ref to attach to the grid
 * container plus a getCellTabIndex helper for consumers to wire up tabindex.
 */

import { type RefObject, useCallback, useRef, useState, type KeyboardEvent } from 'react';

export interface GridCell {
  rowIndex: number;
  colIndex: number;
}

export interface UseGridKeyboardNavigationOptions {
  rowCount: number;
  colCount: number;
  pageSize?: number;
  onActivate?: (cell: GridCell) => void;
}

export interface UseGridKeyboardNavigationResult {
  focusedCell: GridCell;
  setFocusedCell: (cell: GridCell) => void;
  getCellTabIndex: (row: number, col: number) => 0 | -1;
  handleKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  gridRef: RefObject<HTMLDivElement | null>;
}

export function useGridKeyboardNavigation({
  rowCount,
  colCount,
  pageSize = 10,
  onActivate,
}: UseGridKeyboardNavigationOptions): UseGridKeyboardNavigationResult {
  const [focusedCell, setFocusedCell] = useState<GridCell>({ rowIndex: 0, colIndex: 0 });
  const gridRef = useRef<HTMLDivElement | null>(null);

  const clampedMove = useCallback(
    (row: number, col: number): GridCell => ({
      rowIndex: Math.max(0, Math.min(rowCount - 1, row)),
      colIndex: Math.max(0, Math.min(colCount - 1, col)),
    }),
    [rowCount, colCount],
  );

  const focusCell = useCallback((cell: GridCell) => {
    setFocusedCell(cell);
    if (!gridRef.current) return;
    const el = gridRef.current.querySelector<HTMLElement>(
      `[data-row="${cell.rowIndex}"][data-col="${cell.colIndex}"]`,
    );
    el?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const { rowIndex, colIndex } = focusedCell;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          focusCell(clampedMove(rowIndex, colIndex + 1));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          focusCell(clampedMove(rowIndex, colIndex - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          focusCell(clampedMove(rowIndex + 1, colIndex));
          break;
        case 'ArrowUp':
          e.preventDefault();
          focusCell(clampedMove(rowIndex - 1, colIndex));
          break;
        case 'Home':
          e.preventDefault();
          if (e.ctrlKey) {
            focusCell(clampedMove(0, 0));
          } else {
            focusCell(clampedMove(rowIndex, 0));
          }
          break;
        case 'End':
          e.preventDefault();
          if (e.ctrlKey) {
            focusCell(clampedMove(rowCount - 1, colCount - 1));
          } else {
            focusCell(clampedMove(rowIndex, colCount - 1));
          }
          break;
        case 'PageUp':
          e.preventDefault();
          focusCell(clampedMove(rowIndex - pageSize, colIndex));
          break;
        case 'PageDown':
          e.preventDefault();
          focusCell(clampedMove(rowIndex + pageSize, colIndex));
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          onActivate?.({ rowIndex, colIndex });
          break;
        default:
          return;
      }
    },
    [focusedCell, clampedMove, focusCell, rowCount, colCount, pageSize, onActivate],
  );

  const getCellTabIndex = useCallback(
    (row: number, col: number): 0 | -1 => {
      return row === focusedCell.rowIndex && col === focusedCell.colIndex ? 0 : -1;
    },
    [focusedCell],
  );

  return {
    focusedCell,
    setFocusedCell,
    getCellTabIndex,
    handleKeyDown,
    gridRef,
  };
}
