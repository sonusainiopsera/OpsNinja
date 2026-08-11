'use client';

/**
 * MetadataPanel — dynamic custom field form driven by server-defined
 * field definitions (CustomFieldDef).
 *
 * Mapping:
 *   string       → <input type="text">
 *   number       → <input type="number"> (min/max from def constraints)
 *   boolean      → <input type="checkbox">
 *   date         → <input type="date">
 *   select       → <select> (single)
 *   multi_select → checkbox group
 *
 * Archived fields are rendered read-only with an explanation note.
 * Server 400 errors map to per-field messages via fieldKey.
 * 409 conflicts show a non-destructive reload prompt.
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { CustomFieldDef, CustomFieldValue } from '../../../../lib/api/organizations/types';
import { useCustomFieldDefs, useOrgMetadata, useSaveOrgMetadata } from '../../../../lib/api/organizations/hooks';

// ---------------------------------------------------------------------------
// Individual field inputs
// ---------------------------------------------------------------------------

interface FieldInputProps {
  def: CustomFieldDef;
  value: string | number | boolean | string[] | null;
  onChange: (v: string | number | boolean | string[] | null) => void;
  disabled: boolean;
  error?: string;
}

function FieldInput({ def, value, onChange, disabled, error }: FieldInputProps) {
  const baseInputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 10px',
    borderRadius: 6,
    border: `1px solid ${error ? '#f87171' : 'var(--color-border, #d1d5db)'}`,
    fontSize: 13,
    background: disabled ? 'var(--color-bg-alt, #f9fafb)' : 'var(--color-bg-card, #fff)',
    color: disabled ? 'var(--color-muted, #6b7280)' : 'var(--color-fg-primary, #111827)',
    outline: 'none',
    boxSizing: 'border-box',
  };

  if (def.dataType === 'boolean') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer' }}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-label={def.label}
          aria-describedby={error ? `${def.key}-error` : undefined}
        />
        <span style={{ fontSize: 13, color: 'var(--color-fg-secondary, #374151)' }}>
          {value ? 'Yes' : 'No'}
        </span>
      </label>
    );
  }

  if (def.dataType === 'select') {
    return (
      <select
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        aria-label={def.label}
        aria-describedby={error ? `${def.key}-error` : undefined}
        aria-invalid={Boolean(error)}
        style={{ ...baseInputStyle, cursor: disabled ? 'default' : 'pointer' }}
      >
        <option value="">— Select —</option>
        {(def.options ?? []).map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  }

  if (def.dataType === 'multi_select') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset
        disabled={disabled}
        aria-label={def.label}
        aria-describedby={error ? `${def.key}-error` : undefined}
        style={{ border: 'none', padding: 0, margin: 0 }}
      >
        {(def.options ?? []).map((opt) => (
          <label
            key={opt.value}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 4,
              cursor: disabled ? 'default' : 'pointer',
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={selected.includes(opt.value)}
              onChange={(e) => {
                if (e.target.checked) {
                  onChange([...selected, opt.value]);
                } else {
                  onChange(selected.filter((v) => v !== opt.value));
                }
              }}
              disabled={disabled}
            />
            {opt.label}
          </label>
        ))}
      </fieldset>
    );
  }

  if (def.dataType === 'number') {
    return (
      <input
        type="number"
        value={value !== null && value !== undefined ? String(value) : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        disabled={disabled}
        aria-label={def.label}
        aria-describedby={error ? `${def.key}-error` : undefined}
        aria-invalid={Boolean(error)}
        required={def.required}
        style={baseInputStyle}
      />
    );
  }

  // string and date share the same text input
  return (
    <input
      type={def.dataType === 'date' ? 'date' : 'text'}
      value={value !== null && value !== undefined ? String(value) : ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      aria-label={def.label}
      aria-describedby={error ? `${def.key}-error` : undefined}
      aria-invalid={Boolean(error)}
      required={def.required}
      style={baseInputStyle}
    />
  );
}

// ---------------------------------------------------------------------------
// MetadataPanel
// ---------------------------------------------------------------------------

interface MetadataPanelProps {
  orgId: string;
  orgVersion: number;
  canWrite: boolean;
}

export function MetadataPanel({ orgId, orgVersion, canWrite }: MetadataPanelProps) {
  const { data: defs = [], isLoading: defsLoading } = useCustomFieldDefs();
  const { data: savedValues = [], isLoading: valuesLoading } = useOrgMetadata(orgId);
  const saveMutation = useSaveOrgMetadata(orgId);

  // Local form state: fieldKey → value
  const [formValues, setFormValues] = useState<Record<string, string | number | boolean | string[] | null>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflictDetected, setConflictDetected] = useState(false);
  const [savedVersion, setSavedVersion] = useState(orgVersion);

  // Sync server values into local form
  useEffect(() => {
    if (savedValues.length > 0) {
      const initial: Record<string, string | number | boolean | string[] | null> = {};
      savedValues.forEach((v) => { initial[v.fieldKey] = v.value; });
      setFormValues(initial);
    }
  }, [savedValues]);

  const handleChange = useCallback(
    (key: string, value: string | number | boolean | string[] | null) => {
      setFormValues((prev) => ({ ...prev, [key]: value }));
      setFieldErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setFieldErrors({});
    setConflictDetected(false);

    const values: CustomFieldValue[] = Object.entries(formValues).map(([fieldKey, value]) => ({
      fieldKey,
      value,
    }));

    try {
      await saveMutation.mutateAsync({ values, version: savedVersion });
      setSavedVersion((v) => v + 1);
    } catch (err: unknown) {
      const e = err as { status?: number; details?: Array<{ fieldKey?: string; message?: string }> };

      if (e.status === 409) {
        setConflictDetected(true);
        return;
      }

      if (e.status === 400 && Array.isArray(e.details)) {
        const errs: Record<string, string> = {};
        e.details.forEach((d) => {
          if (d.fieldKey) errs[d.fieldKey] = d.message ?? 'Invalid value';
        });
        setFieldErrors(errs);
      }
    }
  }, [formValues, savedVersion, saveMutation]);

  if (defsLoading || valuesLoading) {
    return (
      <div aria-label="Loading metadata" style={{ padding: 24 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ height: 56, background: 'var(--color-bg-alt, #f3f4f6)', borderRadius: 4, marginBottom: 12 }} />
        ))}
      </div>
    );
  }

  const activeDefs = defs.filter((d) => !d.archived);
  const archivedDefs = defs.filter((d) => d.archived);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
      aria-label="Organization metadata"
      noValidate
    >
      {conflictDetected && (
        <div
          role="alert"
          style={{
            margin: '0 0 16px',
            padding: 12,
            borderRadius: 6,
            background: '#fef3c7',
            border: '1px solid #fbbf24',
            fontSize: 13,
            color: '#92400e',
          }}
        >
          <strong>Conflict detected.</strong> Another administrator modified this organization's
          metadata while you were editing.{' '}
          <button
            type="button"
            onClick={() => { setConflictDetected(false); window.location.reload(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1d4ed8', textDecoration: 'underline', fontSize: 13 }}
          >
            Reload to see the latest values
          </button>
          {' '}(your changes are preserved in this form until you reload).
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {activeDefs.length === 0 && (
          <p style={{ fontSize: 14, color: 'var(--color-muted, #6b7280)', textAlign: 'center', padding: 24 }}>
            No custom fields defined yet.
          </p>
        )}

        {activeDefs.map((def) => (
          <FieldRow
            key={def.id}
            def={def}
            value={formValues[def.key] ?? null}
            error={fieldErrors[def.key]}
            disabled={!canWrite}
            onChange={(v) => handleChange(def.key, v)}
          />
        ))}

        {archivedDefs.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 12, color: 'var(--color-muted, #6b7280)', cursor: 'pointer', userSelect: 'none' }}>
              {archivedDefs.length} archived field{archivedDefs.length !== 1 ? 's' : ''} (read-only)
            </summary>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 16 }}>
              {archivedDefs.map((def) => (
                <FieldRow
                  key={def.id}
                  def={def}
                  value={formValues[def.key] ?? null}
                  error={undefined}
                  disabled={true}
                  onChange={() => undefined}
                  archived
                />
              ))}
            </div>
          </details>
        )}
      </div>

      {canWrite && activeDefs.length > 0 && (
        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
          <button
            type="submit"
            disabled={saveMutation.isPending}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--color-primary, #4f46e5)',
              color: '#fff',
              cursor: saveMutation.isPending ? 'wait' : 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save metadata'}
          </button>
          {saveMutation.isSuccess && (
            <span style={{ fontSize: 13, color: '#065f46', alignSelf: 'center' }}>✓ Saved</span>
          )}
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// FieldRow
// ---------------------------------------------------------------------------

interface FieldRowProps {
  def: CustomFieldDef;
  value: string | number | boolean | string[] | null;
  error?: string;
  disabled: boolean;
  onChange: (v: string | number | boolean | string[] | null) => void;
  archived?: boolean;
}

function FieldRow({ def, value, error, disabled, onChange, archived = false }: FieldRowProps) {
  return (
    <div>
      <label
        htmlFor={`meta-field-${def.key}`}
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          color: archived
            ? 'var(--color-muted, #9ca3af)'
            : 'var(--color-fg-secondary, #374151)',
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {def.label}
        {def.required && !archived && (
          <span aria-hidden="true" style={{ color: '#dc2626', marginLeft: 2 }}>*</span>
        )}
        {archived && (
          <span
            style={{
              marginLeft: 6,
              fontWeight: 400,
              fontSize: 10,
              color: 'var(--color-muted, #9ca3af)',
              textTransform: 'none',
            }}
          >
            archived — read-only
          </span>
        )}
      </label>

      <div id={`meta-field-${def.key}`}>
        <FieldInput def={def} value={value} onChange={onChange} disabled={disabled} error={error} />
      </div>

      {error && (
        <p id={`${def.key}-error`} role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 3, marginBottom: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
