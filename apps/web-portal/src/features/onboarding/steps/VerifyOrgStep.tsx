/**
 * VerifyOrgStep — WO-088.
 *
 * Step 1: Read-only organization field grid plus change-request form.
 *
 * - Organization details are displayed read-only (never directly editable).
 * - The user may confirm the details (AC-2) or submit a change request
 *   listing fields to correct (AC-2 — change request, not direct mutation).
 * - Change requests surface to Support Administrators; the organization
 *   registry is never mutated by portal users.
 * - Full keyboard navigation and ARIA landmarks (AC-9).
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import type {
  OnboardingState,
  VerifyOrgPayload,
  ChangeRequestField,
} from '../useOnboarding';

interface VerifyOrgStepProps {
  state:        OnboardingState;
  onSubmit:     (payload: VerifyOrgPayload) => void;
  isSubmitting: boolean;
  error?:       string | null;
}

type Mode = 'review' | 'request_change';

export function VerifyOrgStep({ state, onSubmit, isSubmitting, error }: VerifyOrgStepProps) {
  const { organization, version } = state;
  const [mode, setMode] = useState<Mode>('review');
  const [changeFields, setChangeFields] = useState<ChangeRequestField[]>([]);
  const [addKey, setAddKey] = useState('');
  const [addCurrent, setAddCurrent] = useState('');
  const [addProposed, setAddProposed] = useState('');
  const [addNote, setAddNote] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);

  // Focus heading on mount for keyboard-accessible step entry (AC-9)
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function handleConfirm() {
    onSubmit({ action: 'confirm', version });
  }

  function handleAddField() {
    if (!addKey.trim() || !addProposed.trim()) {
      setFieldError('Field key and proposed value are required.');
      return;
    }
    setFieldError(null);
    setChangeFields((prev) => [
      ...prev,
      {
        key:           addKey.trim(),
        currentValue:  addCurrent.trim(),
        proposedValue: addProposed.trim(),
        note:          addNote.trim() || undefined,
      },
    ]);
    setAddKey('');
    setAddCurrent('');
    setAddProposed('');
    setAddNote('');
  }

  function handleRemoveField(idx: number) {
    setChangeFields((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmitChangeRequest() {
    if (changeFields.length === 0) {
      setFieldError('Add at least one field to change.');
      return;
    }
    onSubmit({ action: 'request_change', fields: changeFields, version });
  }

  return (
    <section aria-labelledby="verify-org-heading" style={{ maxWidth: 640 }}>
      {/* aria-live region for step announcements (AC-9) */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        Step 1 of 3: Verify your organization details
      </div>

      <h2
        id="verify-org-heading"
        ref={headingRef}
        tabIndex={-1}
        style={{ marginBottom: 16, outline: 'none', fontSize: '1.25rem', fontWeight: 600 }}
      >
        Verify your organization details
      </h2>

      <p style={{ marginBottom: 24, color: 'var(--portal-text-secondary, #6b7280)' }}>
        Please review your organization information. If any details are incorrect,
        you can request a correction and our team will update the record.
      </p>

      {/* Read-only organization fields */}
      <div
        role="table"
        aria-label="Organization details"
        style={{ borderRadius: 8, border: '1px solid var(--portal-border, #e5e7eb)', overflow: 'hidden', marginBottom: 24 }}
      >
        <div role="rowgroup">
          {renderFieldRow('Organization name', organization.name)}
          {renderFieldRow('Tier',              organization.tier)}
          {organization.verifiedDomains.length > 0 &&
            renderFieldRow('Verified domains', organization.verifiedDomains.join(', '))}
          {organization.metadata?.map((f) =>
            renderFieldRow(f.label, f.value, f.key),
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div role="alert" aria-live="assertive" style={{ marginBottom: 16, color: 'var(--portal-error, #dc2626)', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {mode === 'review' ? (
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            data-testid="verify-org-confirm-btn"
            style={primaryButtonStyle}
          >
            {isSubmitting ? 'Confirming…' : 'Yes, this is correct'}
          </button>
          <button
            type="button"
            onClick={() => setMode('request_change')}
            disabled={isSubmitting}
            data-testid="verify-org-request-change-btn"
            style={secondaryButtonStyle}
          >
            Request a correction
          </button>
        </div>
      ) : (
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 12 }}>
            What needs to be changed?
          </h3>

          {/* Existing change-request entries */}
          {changeFields.length > 0 && (
            <ul aria-label="Fields to change" style={{ listStyle: 'none', padding: 0, marginBottom: 16 }}>
              {changeFields.map((f, idx) => (
                <li
                  key={idx}
                  style={{
                    display:      'flex',
                    alignItems:   'flex-start',
                    gap:          8,
                    padding:      '8px 12px',
                    background:   'var(--portal-bg-alt, #f9fafb)',
                    borderRadius: 6,
                    marginBottom: 8,
                  }}
                >
                  <span style={{ flex: 1, fontSize: '0.875rem' }}>
                    <strong>{f.key}</strong>:{' '}
                    <s style={{ color: '#9ca3af' }}>{f.currentValue}</s>
                    {' → '}
                    <span style={{ color: '#059669' }}>{f.proposedValue}</span>
                    {f.note && <em style={{ color: '#6b7280' }}> ({f.note})</em>}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.key} change`}
                    onClick={() => handleRemoveField(idx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '1rem' }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add-field form */}
          <fieldset style={{ border: 'none', padding: 0, marginBottom: 16 }}>
            <legend style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 8, display: 'block' }}>
              Add a field to change
            </legend>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <label style={labelStyle}>
                Field
                <input
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value)}
                  placeholder="e.g. name"
                  style={inputStyle}
                  data-testid="change-field-key-input"
                />
              </label>
              <label style={labelStyle}>
                Current value
                <input
                  value={addCurrent}
                  onChange={(e) => setAddCurrent(e.target.value)}
                  placeholder="Current value"
                  style={inputStyle}
                  data-testid="change-field-current-input"
                />
              </label>
              <label style={labelStyle}>
                Proposed value
                <input
                  value={addProposed}
                  onChange={(e) => setAddProposed(e.target.value)}
                  placeholder="New value"
                  style={inputStyle}
                  data-testid="change-field-proposed-input"
                />
              </label>
              <label style={labelStyle}>
                Note (optional)
                <input
                  value={addNote}
                  onChange={(e) => setAddNote(e.target.value)}
                  placeholder="Reason for change"
                  style={inputStyle}
                  data-testid="change-field-note-input"
                />
              </label>
            </div>
            {fieldError && (
              <p role="alert" style={{ color: '#dc2626', fontSize: '0.8125rem', marginBottom: 8 }}>
                {fieldError}
              </p>
            )}
            <button
              type="button"
              onClick={handleAddField}
              style={secondaryButtonStyle}
              data-testid="add-change-field-btn"
            >
              + Add field
            </button>
          </fieldset>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              onClick={handleSubmitChangeRequest}
              disabled={isSubmitting || changeFields.length === 0}
              aria-busy={isSubmitting}
              data-testid="submit-change-request-btn"
              style={primaryButtonStyle}
            >
              {isSubmitting ? 'Submitting…' : 'Submit change request'}
            </button>
            <button
              type="button"
              onClick={() => { setMode('review'); setChangeFields([]); setFieldError(null); }}
              disabled={isSubmitting}
              style={secondaryButtonStyle}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderFieldRow(label: string, value: string, key?: string) {
  return (
    <div
      key={key ?? label}
      role="row"
      style={{
        display:       'flex',
        padding:       '10px 16px',
        borderBottom:  '1px solid var(--portal-border, #e5e7eb)',
        background:    'var(--portal-bg-surface, #fff)',
      }}
    >
      <span role="rowheader" style={{ flex: '0 0 200px', fontWeight: 500, fontSize: '0.875rem', color: '#374151' }}>
        {label}
      </span>
      <span role="cell" style={{ flex: 1, fontSize: '0.875rem', color: '#111827' }}>
        {value || '—'}
      </span>
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  padding:       '10px 20px',
  background:    'var(--portal-primary, #2563eb)',
  color:         '#fff',
  border:        'none',
  borderRadius:  6,
  cursor:        'pointer',
  fontSize:      '0.9375rem',
  fontWeight:    600,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding:       '10px 20px',
  background:    'var(--portal-bg-alt, #f9fafb)',
  color:         'var(--portal-text, #111827)',
  border:        '1px solid var(--portal-border, #e5e7eb)',
  borderRadius:  6,
  cursor:        'pointer',
  fontSize:      '0.9375rem',
};

const labelStyle: React.CSSProperties = {
  display:       'flex',
  flexDirection: 'column',
  gap:           4,
  fontSize:      '0.875rem',
  fontWeight:    500,
  color:         '#374151',
};

const inputStyle: React.CSSProperties = {
  padding:       '7px 10px',
  border:        '1px solid var(--portal-border, #e5e7eb)',
  borderRadius:  6,
  fontSize:      '0.875rem',
  outline:       'none',
};
