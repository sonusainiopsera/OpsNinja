import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGridKeyboardNavigation } from '../domain/DataTable/useGridKeyboardNavigation';

function makeKeyEvent(key: string, extra?: Partial<KeyboardEvent>): KeyboardEvent {
  return { key, preventDefault: vi.fn(), ctrlKey: false, ...extra } as unknown as KeyboardEvent;
}

describe('useGridKeyboardNavigation', () => {
  const opts = { rowCount: 3, colCount: 2 };

  it('starts at row 0 col 0', () => {
    const { result } = renderHook(() => useGridKeyboardNavigation(opts));
    expect(result.current.focusedCell).toEqual({ rowIndex: 0, colIndex: 0 });
  });

  it('ArrowRight moves to next column', () => {
    const { result } = renderHook(() => useGridKeyboardNavigation(opts));
    act(() => result.current.handleKeyDown(makeKeyEvent('ArrowRight') as any));
    expect(result.current.focusedCell).toEqual({ rowIndex: 0, colIndex: 1 });
  });

  it('ArrowRight does not go past last column', () => {
    const { result } = renderHook(() => useGridKeyboardNavigation(opts));
    act(() => result.current.handleKeyDown(makeKeyEvent('ArrowRight') as any));
    act(() => result.current.handleKeyDown(makeKeyEvent('ArrowRight') as any));
    expect(result.current.focusedCell.colIndex).toBe(1); // clamped
  });

  it('ArrowLeft moves to previous column', () => {
    const { result } = renderHook(() => useGridKeyboardNavigation(opts));
    act(() => result.current.handleKeyDown(makeKeyEvent('ArrowRight') as any));
    act(() => result.current.handleKeyDown(makeKeyEvent('ArrowLeft') as any));
    expect(result.current.focusedCell.colIndex).toBe(0);
  });

  it('ArrowDown moves to next row', () => {
    const { result } = renderHook(() => useGridKeyboardNavigation(opts));
    act(() => result.current.handleKeyDown(makeKeyEvent('ArrowDown') as any));
    expect(result.current.focusedCell.rowIndex).toBe(1);
  });

  it('ArrowUp moves to previous row', () => {
    const { result } = renderHook(() => useGridKeyboardNavigation(opts));
    act(() => result.current.handleKeyDown(makeKeyEvent('ArrowDown') as any));
    act(() => result.current.handleKeyDown(makeKeyEvent('ArrowUp') as any));
    expect(result.current.focusedCell.rowIndex).toBe(0);
  });

  it('Home moves to first column in current row', () => {
    const { result } = renderHook(() => useGridKeyboardNavigation(opts));
    act(() => result.current.handleKeyDown(makeKeyEvent('ArrowDown') as any));
    act(() => result.current.handleKeyDown(makeKeyEvent('ArrowRight') as any));
    act(() => result.current.handleKeyDown(makeKeyEvent('Home') as any));
    expect(result.current.focusedCell).toEqual({ rowIndex: 1, colIndex: 0 });
  });

  it('End moves to last column in current row', () => {
    const { result } = renderHook(() => useGridKeyboardNavigation(opts));
    act(() => result.current.handleKeyDown(makeKeyEvent('End') as any));
    expect(result.current.focusedCell.colIndex).toBe(1);
  });

  it('Ctrl+Home moves to first row, first col', () => {
    const { result } = renderHook(() => useGridKeyboardNavigation(opts));
    act(() => result.current.handleKeyDown(makeKeyEvent('ArrowDown') as any));
    act(() => result.current.handleKeyDown(makeKeyEvent('ArrowRight') as any));
    act(() => result.current.handleKeyDown(makeKeyEvent('Home', { ctrlKey: true }) as any));
    expect(result.current.focusedCell).toEqual({ rowIndex: 0, colIndex: 0 });
  });

  it('Ctrl+End moves to last row, last col', () => {
    const { result } = renderHook(() => useGridKeyboardNavigation(opts));
    act(() => result.current.handleKeyDown(makeKeyEvent('End', { ctrlKey: true }) as any));
    expect(result.current.focusedCell).toEqual({ rowIndex: 2, colIndex: 1 });
  });

  it('PageDown advances by pageSize rows', () => {
    const { result } = renderHook(() => useGridKeyboardNavigation({ ...opts, rowCount: 20, pageSize: 5 }));
    act(() => result.current.handleKeyDown(makeKeyEvent('PageDown') as any));
    expect(result.current.focusedCell.rowIndex).toBe(5);
  });

  it('PageUp retreats by pageSize rows', () => {
    const { result } = renderHook(() => useGridKeyboardNavigation({ ...opts, rowCount: 20, pageSize: 5 }));
    act(() => result.current.handleKeyDown(makeKeyEvent('PageDown') as any));
    act(() => result.current.handleKeyDown(makeKeyEvent('PageUp') as any));
    expect(result.current.focusedCell.rowIndex).toBe(0);
  });

  it('Enter fires onActivate', () => {
    const onActivate = vi.fn();
    const { result } = renderHook(() => useGridKeyboardNavigation({ ...opts, onActivate }));
    act(() => result.current.handleKeyDown(makeKeyEvent('Enter') as any));
    expect(onActivate).toHaveBeenCalledWith({ rowIndex: 0, colIndex: 0 });
  });

  it('Space fires onActivate', () => {
    const onActivate = vi.fn();
    const { result } = renderHook(() => useGridKeyboardNavigation({ ...opts, onActivate }));
    act(() => result.current.handleKeyDown(makeKeyEvent(' ') as any));
    expect(onActivate).toHaveBeenCalled();
  });

  it('getCellTabIndex returns 0 for focused cell and -1 for others', () => {
    const { result } = renderHook(() => useGridKeyboardNavigation(opts));
    expect(result.current.getCellTabIndex(0, 0)).toBe(0);
    expect(result.current.getCellTabIndex(0, 1)).toBe(-1);
    expect(result.current.getCellTabIndex(1, 0)).toBe(-1);
  });
});
