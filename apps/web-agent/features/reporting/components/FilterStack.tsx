'use client';

/**
 * FilterStack — stacked list of FilterRow components (WO-078).
 * Manages focus on add/remove (AC-4, AC-10).
 */

import React, { useRef, useEffect } from 'react';
import type { CatalogFieldEntry } from '../../../lib/api/reporting/types';
import type { FilterRowState } from '../state/builder.reducer';
import { FilterRow } from './FilterRow';

interface FilterStackProps {
  filters:        FilterRowState[];
  catalog:        CatalogFieldEntry[];
  onAdd:          () => void;
  onUpdate:       (key: string, patch: Partial<Omit<FilterRowState, 'key'>>) => void;
  onRemove:       (key: string) => void;
  /** Field names from the catalog that are no longer present (retired) */
  retiredFields?: Set<string>;
  disabled?:      boolean;
}

export function FilterStack({
  filters,
  catalog,
  onAdd,
  onUpdate,
  onRemove,
  retiredFields = new Set(),
  disabled = false,
}: FilterStackProps) {
  // Focus the first focusable element of the last filter row after adding
  const stackRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(filters.length);

  useEffect(() => {
    if (filters.length > prevLengthRef.current && stackRef.current) {
      const rows = stackRef.current.querySelectorAll('[role="group"]');
      const last = rows[rows.length - 1] as HTMLElement | undefined;
      if (last) {
        const focusable = last.querySelector<HTMLElement>('select,input,button');
        focusable?.focus();
      }
    }
    prevLengthRef.current = filters.length;
  }, [filters.length]);

  return (
    <section aria-label="Filters" className="filter-stack">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.5rem',
        }}
      >
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-text-secondary)',
          }}
        >
          Filters
        </span>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          aria-label="Add filter"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            padding: '0.25rem 0.75rem',
            borderRadius: 'var(--radius-md, 6px)',
            border: '1px solid var(--color-primary)',
            background: 'var(--color-primary-subtle)',
            color: 'var(--color-primary)',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          <span aria-hidden="true">+</span> Add filter
        </button>
      </div>

      <div
        ref={stackRef}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
        aria-live="polite"
        aria-label="Filter list"
      >
        {filters.length === 0 && (
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--color-text-secondary)',
              fontStyle: 'italic',
              margin: 0,
              padding: '0.5rem 0',
            }}
          >
            No filters applied — all records will be included.
          </p>
        )}
        {filters.map((row) => (
          <FilterRow
            key={row.key}
            row={row}
            catalog={catalog}
            onUpdate={(patch) => onUpdate(row.key, patch)}
            onRemove={() => onRemove(row.key)}
            isRetired={row.field ? retiredFields.has(row.field) : false}
          />
        ))}
      </div>
    </section>
  );
}
