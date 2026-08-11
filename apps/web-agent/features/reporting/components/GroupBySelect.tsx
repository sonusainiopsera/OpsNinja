'use client';

/**
 * GroupBySelect — dimension selector for GROUP BY (WO-078).
 * Driven from catalog; no field name hardcoded.
 */

import React from 'react';
import type { CatalogFieldEntry } from '../../../lib/api/reporting/types';

interface GroupBySelectProps {
  dimensions: CatalogFieldEntry[];
  value:      string | null;
  onChange:   (field: string | null) => void;
  disabled?:  boolean;
}

export function GroupBySelect({ dimensions, value, onChange, disabled = false }: GroupBySelectProps) {
  return (
    <div className="group-by-select">
      <label
        htmlFor="group-by-select"
        style={{
          display:      'block',
          fontSize:     '0.75rem',
          fontWeight:   600,
          textTransform:'uppercase',
          letterSpacing:'0.05em',
          color:        'var(--color-text-secondary)',
          marginBottom: '0.375rem',
        }}
      >
        Group by
      </label>
      <select
        id="group-by-select"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label="Group results by dimension"
        style={{
          width:        '100%',
          padding:      '0.5rem 0.75rem',
          borderRadius: 'var(--radius-md, 6px)',
          border:       '1px solid var(--color-border)',
          background:   'var(--color-surface)',
          color:        'var(--color-text-primary)',
          fontSize:     '0.875rem',
          cursor:       disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <option value="">— No grouping —</option>
        {dimensions.map((d) => (
          <option key={d.name} value={d.name}>
            {d.label}
          </option>
        ))}
      </select>
    </div>
  );
}
