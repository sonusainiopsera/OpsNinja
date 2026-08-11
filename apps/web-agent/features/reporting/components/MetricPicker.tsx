'use client';

/**
 * MetricPicker — multi-select chips for choosing report metrics (WO-078).
 *
 * Driven entirely from the server field catalog; no metric name is hardcoded.
 * Accessibility: fieldset + legend, each chip is a checkbox with visible label.
 */

import React from 'react';
import type { CatalogFieldEntry } from '../../../lib/api/reporting/types';

interface MetricPickerProps {
  metrics:         CatalogFieldEntry[];
  selected:        string[];
  onToggle:        (fieldName: string) => void;
  disabled?:       boolean;
}

export function MetricPicker({ metrics, selected, onToggle, disabled = false }: MetricPickerProps) {
  return (
    <fieldset className="metric-picker" style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend
        style={{
          fontSize: '0.75rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-secondary)',
          marginBottom: '0.5rem',
        }}
      >
        Metrics
      </legend>
      {metrics.length === 0 && (
        <span style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
          Loading metrics…
        </span>
      )}
      <div
        role="group"
        aria-label="Select metrics"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}
      >
        {metrics.map((m) => {
          const isSelected = selected.includes(m.name);
          return (
            <label
              key={m.name}
              style={{
                display:       'inline-flex',
                alignItems:    'center',
                gap:           '0.375rem',
                padding:       '0.25rem 0.75rem',
                borderRadius:  '9999px',
                fontSize:      '0.875rem',
                fontWeight:    isSelected ? 600 : 400,
                cursor:        disabled ? 'not-allowed' : 'pointer',
                border:        `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background:    isSelected ? 'var(--color-primary-subtle)' : 'var(--color-surface)',
                color:         isSelected ? 'var(--color-primary)' : 'var(--color-text-primary)',
                opacity:       disabled ? 0.5 : 1,
                userSelect:    'none',
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={disabled}
                onChange={() => onToggle(m.name)}
                aria-label={m.label}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
              />
              {isSelected && (
                <span aria-hidden="true" style={{ lineHeight: 1 }}>✓</span>
              )}
              <span>{m.label}</span>
            </label>
          );
        })}
      </div>
      {selected.length === 0 && metrics.length > 0 && (
        <p
          role="alert"
          style={{ fontSize: '0.75rem', color: 'var(--color-text-warning)', marginTop: '0.25rem' }}
        >
          Select at least one metric to run the report.
        </p>
      )}
    </fieldset>
  );
}
