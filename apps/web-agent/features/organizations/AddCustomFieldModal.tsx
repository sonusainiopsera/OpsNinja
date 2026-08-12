'use client';

/**
 * AddCustomFieldModal — create a new custom field definition.
 *
 * Fields: key (machine key), label, dataType, required flag,
 *         appliesToTier (multi-select), options (for select/multi_select).
 *
 * On success: invalidates the customFieldDefs query so MetadataPanel
 * reflects the new field without a full page reload.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { CustomFieldDataType, OrgTier } from '../../lib/api/organizations/types';
import { useCreateCustomFieldDef } from '../../lib/api/organizations/hooks';

interface AddCustomFieldModalProps {
  open: boolean;
  onClose: () => void;
}

const DATA_TYPES: { value: CustomFieldDataType; label: string }[] = [
  { value: 'string',       label: 'Text' },
  { value: 'number',       label: 'Number' },
  { value: 'boolean',      label: 'Yes/No (checkbox)' },
  { value: 'date',         label: 'Date' },
  { value: 'select',       label: 'Single select' },
  { value: 'multi_select', label: 'Multi select' },
];

const TIER_OPTIONS: OrgTier[] = ['free', 'starter', 'growth', 'enterprise'];

interface OptionRow {
  value: string;
  label: string;
}

export function AddCustomFieldModal({ open, onClose }: AddCustomFieldModalProps) {
  const createMutation = useCreateCustomFieldDef();
  const firstFocusRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    key: '',
    label: '',
    dataType: 'string' as CustomFieldDataType,
    required: false,
    appliesToTier: null as OrgTier[] | null,
  });
  const [options, setOptions] = useState<OptionRow[]>([{ value: '', label: '' }]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Focus first input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => firstFocusRef.current?.focus(), 50);
    } else {
      // Reset form on close
      setForm({ key: '', label: '', dataType: 'string', required: false, appliesToTier: null });
      setOptions([{ value: '', label: '' }]);
      setFieldErrors({});
    }
  }, [open]);

  // Focus trap
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const needsOptions = form.dataType === 'select' || form.dataType === 'multi_select';

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});

    const finalOptions = needsOptions
      ? options.filter((o) => o.value.trim() && o.label.trim())
      : undefined;

    try {
      await createMutation.mutateAsync({
        key: form.key,
        label: form.label,
        dataType: form.dataType,
        required: form.required,
        appliesToTier: form.appliesToTier,
        options: finalOptions ?? null,
      });
      onClose();
    } catch (err: unknown) {
      const e = err as {
        status?: number;
        details?: Array<{ fieldKey?: string; message?: string }>;
        message?: string;
      };
      if (e.status === 400 && Array.isArray(e.details)) {
        const errs: Record<string, string> = {};
        e.details.forEach((d) => {
          if (d.fieldKey) errs[d.fieldKey] = d.message ?? 'Invalid';
        });
        setFieldErrors(errs);
      } else if (e.status === 409) {
        setFieldErrors({ key: e.message ?? 'Key already exists' });
      }
    }
  }, [form, options, needsOptions, createMutation, onClose]);

  const handleTierToggle = (tier: OrgTier) => {
    setForm((prev) => {
      const current = prev.appliesToTier ?? [];
      const next = current.includes(tier)
        ? current.filter((t) => t !== tier)
        : [...current, tier];
      return { ...prev, appliesToTier: next.length > 0 ? next : null };
    });
  };

  const inputStyle = (field: string): React.CSSProperties => ({
    width: '100%',
    padding: '7px 10px',
    borderRadius: 6,
    border: `1px solid ${fieldErrors[field] ? '#f87171' : 'var(--color-border, #d1d5db)'}`,
    fontSize: 13,
    background: 'var(--color-bg-card, #fff)',
    boxSizing: 'border-box',
    outline: 'none',
  });

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 200,
        }}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-field-title"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'var(--color-bg-card, #fff)',
          borderRadius: 10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          zIndex: 201,
          width: 'min(520px, 95vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 id="add-field-title" style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Add custom field
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 20,
              lineHeight: 1,
              color: 'var(--color-muted, #6b7280)',
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Key */}
            <div>
              <label htmlFor="cf-key" style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Field key *
              </label>
              <input
                ref={firstFocusRef}
                id="cf-key"
                type="text"
                value={form.key}
                onChange={(e) => setForm((p) => ({ ...p, key: e.target.value }))}
                required
                placeholder="e.g. crm_account_id"
                aria-invalid={Boolean(fieldErrors['key'])}
                style={inputStyle('key')}
              />
              <p style={{ fontSize: 11, color: 'var(--color-muted, #6b7280)', marginTop: 3 }}>
                Lowercase letters, numbers, underscores only. Cannot be changed after creation.
              </p>
              {fieldErrors['key'] && (
                <p role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>{fieldErrors['key']}</p>
              )}
            </div>

            {/* Label */}
            <div>
              <label htmlFor="cf-label" style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Display label *
              </label>
              <input
                id="cf-label"
                type="text"
                value={form.label}
                onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
                required
                placeholder="e.g. CRM Account ID"
                aria-invalid={Boolean(fieldErrors['label'])}
                style={inputStyle('label')}
              />
              {fieldErrors['label'] && (
                <p role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>{fieldErrors['label']}</p>
              )}
            </div>

            {/* Data type */}
            <div>
              <label htmlFor="cf-type" style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Data type *
              </label>
              <select
                id="cf-type"
                value={form.dataType}
                onChange={(e) => {
                  setForm((p) => ({ ...p, dataType: e.target.value as CustomFieldDataType }));
                  setOptions([{ value: '', label: '' }]);
                }}
                style={{ ...inputStyle('dataType'), cursor: 'pointer' }}
              >
                {DATA_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Options (for select types) */}
            {needsOptions && (
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Options *
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {options.map((opt, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text"
                        placeholder="value"
                        value={opt.value}
                        onChange={(e) => {
                          const next = [...options];
                          next[idx] = { ...next[idx]!, value: e.target.value };
                          setOptions(next);
                        }}
                        style={{ ...inputStyle('options'), flex: 1 }}
                        aria-label={`Option ${idx + 1} value`}
                      />
                      <input
                        type="text"
                        placeholder="label"
                        value={opt.label}
                        onChange={(e) => {
                          const next = [...options];
                          next[idx] = { ...next[idx]!, label: e.target.value };
                          setOptions(next);
                        }}
                        style={{ ...inputStyle('options'), flex: 1 }}
                        aria-label={`Option ${idx + 1} label`}
                      />
                      {options.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove option ${idx + 1}`}
                          onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                          style={{
                            padding: '4px 8px',
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            color: '#dc2626',
                            fontSize: 16,
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setOptions([...options, { value: '', label: '' }])}
                    style={{
                      alignSelf: 'flex-start',
                      padding: '4px 10px',
                      borderRadius: 4,
                      border: '1px dashed var(--color-primary, #4f46e5)',
                      background: 'transparent',
                      color: 'var(--color-primary, #4f46e5)',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    + Add option
                  </button>
                </div>
                {fieldErrors['options'] && (
                  <p role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>{fieldErrors['options']}</p>
                )}
              </div>
            )}

            {/* Required */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.required}
                onChange={(e) => setForm((p) => ({ ...p, required: e.target.checked }))}
              />
              Required field
            </label>

            {/* Applies to tier */}
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Applies to tiers (leave blank for all)
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {TIER_OPTIONS.map((tier) => (
                  <label
                    key={tier}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      fontSize: 13,
                      padding: '4px 10px',
                      borderRadius: 99,
                      border: `1px solid ${
                        (form.appliesToTier ?? []).includes(tier)
                          ? 'var(--color-primary, #4f46e5)'
                          : 'var(--color-border, #d1d5db)'
                      }`,
                      background: (form.appliesToTier ?? []).includes(tier)
                        ? 'var(--color-primary-soft, #eef2ff)'
                        : 'var(--color-bg-card, #fff)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={(form.appliesToTier ?? []).includes(tier)}
                      onChange={() => handleTierToggle(tier)}
                      style={{ display: 'none' }}
                    />
                    {tier}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
            <button
              type="submit"
              disabled={createMutation.isPending}
              style={{
                flex: 1,
                padding: '9px 0',
                borderRadius: 6,
                border: 'none',
                background: 'var(--color-primary, #4f46e5)',
                color: '#fff',
                cursor: createMutation.isPending ? 'wait' : 'pointer',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              {createMutation.isPending ? 'Creating…' : 'Create field'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '9px 20px',
                borderRadius: 6,
                border: '1px solid var(--color-border, #d1d5db)',
                background: 'var(--color-bg-card, #fff)',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
