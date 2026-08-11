'use client';

/**
 * VisualizationToggle — table / bar / line chart toggle (WO-078).
 * Renders a segmented button group (role="radiogroup").
 */

import React from 'react';
import type { ChartType } from '../../../lib/api/reporting/types';

const OPTIONS: Array<{ value: ChartType; label: string; icon: string }> = [
  { value: 'table', label: 'Table',     icon: '⊞' },
  { value: 'bar',   label: 'Bar chart', icon: '▦' },
  { value: 'line',  label: 'Line chart',icon: '∿' },
];

interface VisualizationToggleProps {
  value:     ChartType;
  onChange:  (v: ChartType) => void;
  disabled?: boolean;
}

export function VisualizationToggle({ value, onChange, disabled = false }: VisualizationToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Visualization type"
      style={{ display: 'inline-flex', borderRadius: 'var(--radius-md, 6px)', overflow: 'hidden', border: '1px solid var(--color-border)' }}
    >
      {OPTIONS.map((opt, idx) => {
        const isSelected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            style={{
              padding:       '0.375rem 0.875rem',
              background:    isSelected ? 'var(--color-primary)' : 'var(--color-surface)',
              color:         isSelected ? 'var(--color-on-primary, #fff)' : 'var(--color-text-primary)',
              border:        'none',
              borderLeft:    idx > 0 ? '1px solid var(--color-border)' : 'none',
              cursor:        disabled ? 'not-allowed' : 'pointer',
              fontSize:      '0.875rem',
              fontWeight:    isSelected ? 600 : 400,
              display:       'inline-flex',
              gap:           '0.375rem',
              alignItems:    'center',
            }}
            aria-label={opt.label}
          >
            <span aria-hidden="true">{opt.icon}</span>
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
