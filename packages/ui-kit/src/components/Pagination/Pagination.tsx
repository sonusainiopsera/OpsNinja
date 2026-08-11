'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from '../../icons/index.js';
import { cn } from '../../lib/cn.js';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const MAX_LIMIT = 100;

export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  nextCursor?: string | null;
  prevCursor?: string | null;
  limit: number;
  onNext?: (cursor: string) => void;
  onPrev?: (cursor: string) => void;
  onLimitChange?: (limit: number) => void;
}

export function Pagination({
  nextCursor,
  prevCursor,
  limit,
  onNext,
  onPrev,
  onLimitChange,
  className,
  ...props
}: PaginationProps) {
  const clampedLimit = Math.min(limit, MAX_LIMIT);

  function handleLimitChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = Math.min(parseInt(e.target.value, 10), MAX_LIMIT);
    onLimitChange?.(val);
  }

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex items-center gap-3 text-sm', className)}
      {...props}
    >
      <div className="flex items-center gap-2">
        <label htmlFor="pagination-limit" className="text-secondary text-xs">
          Per page:
        </label>
        <select
          id="pagination-limit"
          value={clampedLimit}
          onChange={handleLimitChange}
          disabled={!onLimitChange}
          className={cn(
            'h-8 rounded-md border border-border-default bg-surface px-2 text-xs text-primary',
            'focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {PAGE_SIZE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous page"
          disabled={!prevCursor}
          onClick={() => prevCursor && onPrev?.(prevCursor)}
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-md border border-border-default',
            'text-secondary hover:bg-surface-raised transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Next page"
          disabled={!nextCursor}
          onClick={() => nextCursor && onNext?.(nextCursor)}
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-md border border-border-default',
            'text-secondary hover:bg-surface-raised transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </nav>
  );
}
