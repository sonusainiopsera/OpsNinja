/**
 * useGridKeyboardNavigation — roving-tabindex keyboard navigation for role="grid".
 *
 * Arrow keys move focus between cells. Home/End jump to row edges.
 * PageUp/PageDown jump to first/last row in the same column.
 * The single focusable cell has tabIndex=0; all others have tabIndex=-1.
 */

import { useCallback, useRef } from 'react';

export interface GridNavigationResult {
  /** Ref to attach to the grid container element. */
  gridRef: React.RefObject<HTMLTableElement>;
  /** Returns tabIndex (0 or -1) for the cell at [rowIndex][colIndex]. */
  getCellTabIndex: (rowIndex: number, colIndex: number) => 0 | -1;
  /** Call on keydown inside the grid. */
  handleKeyDown: (e: React.KeyboardEvent<HTMLTableElement>) => void;
  /** Call when a cell is clicked to move roving focus to it. */
  handleCellClick: (rowIndex: number, colIndex: number) => void;
}

export function useGridKeyboardNavigation(rowCount: number, colCount: number): GridNavigationResult {
  const gridRef = useRef<HTMLTableElement>(null);
  const focusedCell = useRef<[number, number]>([0, 0]);

  const focus = useCallback(
    (rowIndex: number, colIndex: number) => {
      if (rowCount === 0 || colCount === 0) return;
      const r = Math.max(0, Math.min(rowIndex, rowCount - 1));
      const c = Math.max(0, Math.min(colIndex, colCount - 1));
      if (focusedCell.current[0] === r && focusedCell.current[1] === c) return;

      const grid = gridRef.current;
      if (!grid) {
        focusedCell.current = [r, c];
        return;
      }

      // Remove tabIndex=0 from current cell
      const [pr, pc] = focusedCell.current;
      const prev = grid.querySelector<HTMLElement>(
        `[data-row-index="${pr}"] [data-col-index="${pc}"]`,
      );
      if (prev) prev.tabIndex = -1;

      focusedCell.current = [r, c];

      const next = grid.querySelector<HTMLElement>(
        `[data-row-index="${r}"] [data-col-index="${c}"]`,
      );
      if (next) {
        next.tabIndex = 0;
        next.focus();
      }
    },
    [rowCount, colCount],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableElement>) => {
      const [r, c] = focusedCell.current;
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          focus(r, c + 1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          focus(r, c - 1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          focus(r + 1, c);
          break;
        case 'ArrowUp':
          e.preventDefault();
          focus(r - 1, c);
          break;
        case 'Home':
          e.preventDefault();
          if (e.ctrlKey) focus(0, 0);
          else focus(r, 0);
          break;
        case 'End':
          e.preventDefault();
          if (e.ctrlKey) focus(rowCount - 1, colCount - 1);
          else focus(r, colCount - 1);
          break;
        case 'PageUp':
          e.preventDefault();
          focus(0, c);
          break;
        case 'PageDown':
          e.preventDefault();
          focus(rowCount - 1, c);
          break;
      }
    },
    [focus, rowCount, colCount],
  );

  const handleCellClick = useCallback(
    (rowIndex: number, colIndex: number) => {
      focus(rowIndex, colIndex);
    },
    [focus],
  );

  const getCellTabIndex = useCallback(
    (rowIndex: number, colIndex: number): 0 | -1 => {
      const [r, c] = focusedCell.current;
      return rowIndex === r && colIndex === c ? 0 : -1;
    },
    [],
  );

  return { gridRef, getCellTabIndex, handleKeyDown, handleCellClick };
}
