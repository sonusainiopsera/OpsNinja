'use client';

/**
 * AddFilterDrawer — slide-in panel for constructing allow-listed filter AST nodes.
 *
 * Derives available fields and operators exclusively from FIELD_REGISTRY so
 * the client cannot emit an AST the server would reject. Unknown fields and
 * operator/field mismatches are structurally impossible because only the
 * allow-listed combinations are rendered.
 *
 * Accessibility:
 *   - role="dialog" with aria-modal + aria-label
 *   - Focus trapped while open; Escape closes
 *   - Labelled controls throughout
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FIELD_REGISTRY,
  OPERATORS,
  type FieldName,
  type FilterAst,
  type GroupNode,
} from '@opsninja/filter-compiler';

// ---------------------------------------------------------------------------
// UI label helpers
// ---------------------------------------------------------------------------

const FIELD_LABELS: Partial<Record<string, string>> = {
  status: 'Status',
  priority: 'Priority',
  category_id: 'Category',
  category_path: 'Category Path',
  tag_id: 'Tag',
  assignment_group_id: 'Assignment Group',
  assignee_user_id: 'Assignee',
  organization_id: 'Organization',
  sla_state: 'SLA State',
  created_at: 'Created At',
  updated_at: 'Updated At',
  resolved_at: 'Resolved At',
  has_jira_link: 'Has Jira Link',
  affected_area: 'Affected Area',
};

const OPERATOR_LABELS: Record<string, string> = {
  eq: 'equals',
  neq: 'not equals',
  in: 'is one of',
  not_in: 'is not one of',
  gt: 'after',
  gte: 'on or after',
  lt: 'before',
  lte: 'on or before',
  between: 'between',
  is_null: 'is empty',
  is_not_null: 'is not empty',
  contains: 'contains',
};

const NULL_OPS = new Set(['is_null', 'is_not_null']);
const ARRAY_OPS = new Set(['in', 'not_in']);

function getEnumValues(fieldName: string): string[] | null {
  const entry = FIELD_REGISTRY[fieldName];
  if (!entry) return null;
  // Enum values live in the scalarValueSchema – extract them when available
  const schema = entry.scalarValueSchema as { options?: string[] };
  if (schema?.options && Array.isArray(schema.options)) {
    return schema.options;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AddFilterDrawerProps {
  open: boolean;
  onClose: () => void;
  currentFilter: FilterAst | null;
  onApply: (next: FilterAst) => void;
}

export function AddFilterDrawer({ open, onClose, currentFilter, onApply }: AddFilterDrawerProps) {
  const [selectedField, setSelectedField] = useState<string>('status');
  const [selectedOp, setSelectedOp] = useState<string>('eq');
  const [value, setValue] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus management
  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
    }
  }, [open]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (!open || !drawerRef.current) return;
    const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const fieldEntry = FIELD_REGISTRY[selectedField as FieldName];
  const allowedOps = fieldEntry?.allowedOperators ?? [];

  // Reset operator when field changes
  const handleFieldChange = useCallback((f: string) => {
    setSelectedField(f);
    const entry = FIELD_REGISTRY[f as FieldName];
    setSelectedOp(entry?.allowedOperators[0] ?? 'eq');
    setValue('');
    setError(null);
  }, []);

  const handleOpChange = useCallback((op: string) => {
    setSelectedOp(op);
    setValue('');
    setError(null);
  }, []);

  const handleApply = useCallback(() => {
    if (!fieldEntry) return;
    setError(null);

    // Build value
    let condValue: unknown = value;

    if (NULL_OPS.has(selectedOp)) {
      condValue = null;
    } else if (ARRAY_OPS.has(selectedOp)) {
      const arr = value.split(',').map((s) => s.trim()).filter(Boolean);
      if (arr.length === 0) { setError('Enter at least one value'); return; }
      condValue = arr;
    } else if (fieldEntry.sqlType === 'boolean') {
      condValue = value === 'true';
    } else if (!value.trim()) {
      setError('Value is required');
      return;
    }

    const newCondition: FilterAst = {
      type: 'condition',
      field: selectedField,
      operator: selectedOp,
      value: condValue,
    };

    // Merge into existing AST
    let next: FilterAst;
    if (!currentFilter) {
      next = newCondition;
    } else if (currentFilter.type === 'group' && currentFilter.op === 'and') {
      next = { ...currentFilter, children: [...currentFilter.children, newCondition] } as GroupNode;
    } else {
      next = { type: 'group', op: 'and', children: [currentFilter, newCondition] } as GroupNode;
    }

    onApply(next);
    setValue('');
    onClose();
  }, [fieldEntry, selectedField, selectedOp, value, currentFilter, onApply, onClose]);

  if (!open) return null;

  const showValueInput = !NULL_OPS.has(selectedOp);
  const enumValues = getEnumValues(selectedField);
  const isArray = ARRAY_OPS.has(selectedOp);

  const DRAWER_STYLE: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 200,
    display: 'flex',
    justifyContent: 'flex-end',
  };

  const OVERLAY_STYLE: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.3)',
  };

  return (
    <div style={DRAWER_STYLE} aria-hidden={!open}>
      {/* Overlay */}
      <div style={OVERLAY_STYLE} onClick={onClose} aria-hidden="true" />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add filter"
        style={{
          position: 'relative',
          width: 360,
          height: '100%',
          background: 'var(--color-bg-card, #fff)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-fg-primary, #111827)' }}>
            Add Filter
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close filter drawer"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 20,
              lineHeight: 1,
              color: 'var(--color-muted, #6b7280)',
              padding: 4,
              borderRadius: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Field selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="filter-field"
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-fg-secondary, #374151)' }}
          >
            Field
          </label>
          <select
            id="filter-field"
            value={selectedField}
            onChange={(e) => handleFieldChange(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--color-border, #d1d5db)',
              fontSize: 13,
              background: 'var(--color-bg-input, #fff)',
              color: 'var(--color-fg-primary, #111827)',
            }}
          >
            {Object.keys(FIELD_REGISTRY).map((field) => (
              <option key={field} value={field}>
                {FIELD_LABELS[field] ?? field}
              </option>
            ))}
          </select>
        </div>

        {/* Operator selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor="filter-operator"
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-fg-secondary, #374151)' }}
          >
            Condition
          </label>
          <select
            id="filter-operator"
            value={selectedOp}
            onChange={(e) => handleOpChange(e.target.value)}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--color-border, #d1d5db)',
              fontSize: 13,
              background: 'var(--color-bg-input, #fff)',
              color: 'var(--color-fg-primary, #111827)',
            }}
          >
            {(allowedOps as string[]).map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABELS[op] ?? op}
              </option>
            ))}
          </select>
        </div>

        {/* Value input */}
        {showValueInput && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label
              htmlFor="filter-value"
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-fg-secondary, #374151)' }}
            >
              Value
              {isArray && (
                <span style={{ fontWeight: 400, color: 'var(--color-muted, #6b7280)', marginLeft: 6 }}>
                  (comma-separated)
                </span>
              )}
            </label>
            {enumValues && !isArray ? (
              <select
                id="filter-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: `1px solid ${error ? '#ef4444' : 'var(--color-border, #d1d5db)'}`,
                  fontSize: 13,
                  background: 'var(--color-bg-input, #fff)',
                  color: 'var(--color-fg-primary, #111827)',
                }}
              >
                <option value="">-- select --</option>
                {enumValues.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            ) : fieldEntry?.sqlType === 'boolean' ? (
              <select
                id="filter-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: `1px solid ${error ? '#ef4444' : 'var(--color-border, #d1d5db)'}`,
                  fontSize: 13,
                  background: 'var(--color-bg-input, #fff)',
                  color: 'var(--color-fg-primary, #111827)',
                }}
              >
                <option value="">-- select --</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input
                id="filter-value"
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={
                  fieldEntry?.sqlType === 'timestamp' ? 'ISO date or today/yesterday/…' :
                  fieldEntry?.sqlType === 'uuid' ? 'UUID' : 'Value'
                }
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'filter-value-error' : undefined}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: `1px solid ${error ? '#ef4444' : 'var(--color-border, #d1d5db)'}`,
                  fontSize: 13,
                  background: 'var(--color-bg-input, #fff)',
                  color: 'var(--color-fg-primary, #111827)',
                }}
              />
            )}
            {error && (
              <p id="filter-value-error" role="alert" style={{ color: '#ef4444', fontSize: 12, margin: 0 }}>
                {error}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
          <button
            type="button"
            onClick={handleApply}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--color-primary, #4f46e5)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Apply
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: 6,
              border: '1px solid var(--color-border, #d1d5db)',
              background: 'transparent',
              color: 'var(--color-fg-secondary, #374151)',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
