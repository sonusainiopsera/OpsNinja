'use client';

/**
 * FilterRow — a single filter condition row (WO-078).
 *
 * Field → Operator → Value controls driven from catalog.
 * Operator list reacts to the selected field's data type.
 * Value control type changes with field:
 *   text_enum  → multi-select / checkboxes (in / not_in)
 *   timestamp  → date range inputs
 *   date       → date range inputs
 *   integer    → number input
 *   numeric    → number input
 *   uuid       → text input (for org picker, shown as text)
 *   text       → text input
 */

import React, { useId } from 'react';
import type { CatalogFieldEntry, CatalogDataType } from '../../../lib/api/reporting/types';
import type { FilterRowState } from '../state/builder.reducer';

// Operator display labels
const OPERATOR_LABELS: Record<string, string> = {
  eq:           'equals',
  neq:          'not equals',
  lt:           'less than',
  lte:          'less than or equal',
  gt:           'greater than',
  gte:          'greater than or equal',
  in:           'is one of',
  not_in:       'is not one of',
  between:      'is between',
  before:       'before',
  after:        'after',
  contains:     'contains',
  not_contains: 'does not contain',
  is_null:      'is empty',
  is_not_null:  'is not empty',
};

function ValueControl({
  field,
  operator,
  value,
  onChange,
}: {
  field:    CatalogFieldEntry | undefined;
  operator: string;
  value:    unknown;
  onChange: (v: unknown) => void;
}) {
  if (!field || !operator) return null;
  // No-value operators
  if (operator === 'is_null' || operator === 'is_not_null') return null;

  const { dataType, enumValues } = field;
  const baseInputStyle: React.CSSProperties = {
    padding:      '0.375rem 0.5rem',
    borderRadius: 'var(--radius-sm, 4px)',
    border:       '1px solid var(--color-border)',
    background:   'var(--color-surface)',
    color:        'var(--color-text-primary)',
    fontSize:     '0.875rem',
    minWidth:     120,
  };

  // Enum: in/not_in → multi-select
  if ((dataType === 'text_enum') && (operator === 'in' || operator === 'not_in') && enumValues) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <select
        multiple
        value={selected}
        onChange={(e) => {
          const opts = Array.from(e.target.selectedOptions, (o) => o.value);
          onChange(opts);
        }}
        aria-label="Select values"
        style={{ ...baseInputStyle, height: Math.min(enumValues.length, 5) * 28 + 8 }}
      >
        {enumValues.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    );
  }

  // Enum: single eq/neq
  if (dataType === 'text_enum' && enumValues) {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Select value"
        style={baseInputStyle}
      >
        <option value="">— select —</option>
        {enumValues.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    );
  }

  // Date / timestamp: between = two inputs
  if ((dataType === 'timestamp' || dataType === 'date') && operator === 'between') {
    const arr = Array.isArray(value) ? (value as string[]) : ['', ''];
    return (
      <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="date"
          value={arr[0] ?? ''}
          onChange={(e) => onChange([e.target.value, arr[1] ?? ''])}
          aria-label="From date"
          style={baseInputStyle}
        />
        <span aria-hidden="true">–</span>
        <input
          type="date"
          value={arr[1] ?? ''}
          onChange={(e) => onChange([arr[0] ?? '', e.target.value])}
          aria-label="To date"
          style={baseInputStyle}
        />
      </span>
    );
  }

  // Date / timestamp: single
  if (dataType === 'timestamp' || dataType === 'date') {
    return (
      <input
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Date value"
        style={baseInputStyle}
      />
    );
  }

  // Numeric / integer
  if (dataType === 'integer' || dataType === 'numeric') {
    return (
      <input
        type="number"
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        aria-label="Numeric value"
        style={{ ...baseInputStyle, width: 100 }}
      />
    );
  }

  // Default: text
  return (
    <input
      type="text"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter value"
      placeholder="value"
      style={baseInputStyle}
    />
  );
}

interface FilterRowProps {
  row:        FilterRowState;
  catalog:    CatalogFieldEntry[];
  onUpdate:   (patch: Partial<Omit<FilterRowState, 'key'>>) => void;
  onRemove:   () => void;
  isRetired?: boolean;
}

export function FilterRow({ row, catalog, onUpdate, onRemove, isRetired = false }: FilterRowProps) {
  const fieldId    = useId();
  const operatorId = useId();

  const selectedField = catalog.find((f) => f.name === row.field);

  return (
    <div
      role="group"
      aria-label={`Filter: ${row.field || 'new filter'}`}
      style={{
        display:    'flex',
        gap:        '0.5rem',
        alignItems: 'flex-start',
        flexWrap:   'wrap',
        padding:    '0.5rem',
        borderRadius: 'var(--radius-md, 6px)',
        background: isRetired ? 'var(--color-error-subtle, #fef2f2)' : 'var(--color-surface-raised, var(--color-surface))',
        border:     `1px solid ${isRetired ? 'var(--color-error, #ef4444)' : 'var(--color-border)'}`,
      }}
    >
      {isRetired && (
        <span
          role="alert"
          style={{ width: '100%', fontSize: '0.75rem', color: 'var(--color-error, #ef4444)', fontWeight: 600 }}
        >
          This field has been removed from the catalog. Remove this filter to continue.
        </span>
      )}

      {/* Field selector */}
      <div>
        <label htmlFor={fieldId} style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: 2 }}>
          Field
        </label>
        <select
          id={fieldId}
          value={row.field}
          onChange={(e) => onUpdate({ field: e.target.value, operator: '', value: null })}
          aria-label="Filter field"
          style={{
            padding: '0.375rem 0.5rem',
            borderRadius: 'var(--radius-sm, 4px)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text-primary)',
            fontSize: '0.875rem',
          }}
        >
          <option value="">— field —</option>
          {catalog
            .filter((f) => f.fieldKind === 'dimension' && f.allowedOperators.length > 0)
            .map((f) => (
              <option key={f.name} value={f.name}>{f.label}</option>
            ))}
        </select>
      </div>

      {/* Operator selector — only shown when a field is selected */}
      {selectedField && (
        <div>
          <label htmlFor={operatorId} style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: 2 }}>
            Operator
          </label>
          <select
            id={operatorId}
            value={row.operator}
            onChange={(e) => onUpdate({ operator: e.target.value, value: null })}
            aria-label="Filter operator"
            style={{
              padding: '0.375rem 0.5rem',
              borderRadius: 'var(--radius-sm, 4px)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
              fontSize: '0.875rem',
            }}
          >
            <option value="">— operator —</option>
            {selectedField.allowedOperators.map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABELS[op] ?? op}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Value control */}
      {selectedField && row.operator && (
        <div style={{ flex: 1 }}>
          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: 2 }}>
            Value
          </span>
          <ValueControl
            field={selectedField}
            operator={row.operator}
            value={row.value}
            onChange={(v) => onUpdate({ value: v })}
          />
        </div>
      )}

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove filter"
        style={{
          marginTop: 20,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-secondary)',
          fontSize: '1.1rem',
          lineHeight: 1,
          padding: '0.25rem',
        }}
      >
        ✕
      </button>
    </div>
  );
}
