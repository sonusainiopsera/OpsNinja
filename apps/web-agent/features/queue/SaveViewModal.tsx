'use client';

/**
 * SaveViewModal — modal dialog to persist the current filters as a named view.
 *
 * Accessibility:
 *   - role="dialog" with aria-modal + aria-labelledby
 *   - Focus trapped; Escape closes
 *   - Form validation with inline errors
 */

import React, { useEffect, useRef, useState } from 'react';
import type { FilterAst } from '@opsninja/filter-compiler';
import type { ViewScope } from '../../lib/api/views/types';
import { useCreateView } from '../../lib/api/views/hooks';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SaveViewModalProps {
  open: boolean;
  onClose: () => void;
  currentFilter: FilterAst | null;
  currentSort: string | null;
  currentSortDir: 'asc' | 'desc' | null;
  canCreateShared: boolean;
}

export function SaveViewModal({
  open,
  onClose,
  currentFilter,
  currentSort,
  currentSortDir,
  canCreateShared,
}: SaveViewModalProps) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ViewScope>('private');
  const [nameError, setNameError] = useState<string | null>(null);
  const createView = useCreateView();
  const titleId = 'save-view-modal-title';
  const nameInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus on open
  useEffect(() => {
    if (open) {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    } else {
      // Reset form on close
      setName('');
      setScope('private');
      setNameError(null);
    }
  }, [open]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (!open || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, input, select, [tabindex]:not([tabindex="-1"])',
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

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('View name is required');
      nameInputRef.current?.focus();
      return;
    }
    if (trimmed.length > 100) {
      setNameError('Name must be 100 characters or fewer');
      nameInputRef.current?.focus();
      return;
    }

    try {
      await createView.mutateAsync({
        name: trimmed,
        scope,
        filter: currentFilter,
        sort: currentSort,
        sortDir: currentSortDir,
      });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save view';
      setNameError(msg);
    }
  };

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          width: 400,
          background: 'var(--color-bg-card, #fff)',
          borderRadius: 10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          padding: 28,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2
            id={titleId}
            style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-fg-primary, #111827)' }}
          >
            Save View
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
              color: 'var(--color-muted, #6b7280)',
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* View name */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label
              htmlFor="view-name"
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-fg-secondary, #374151)' }}
            >
              View name <span aria-hidden="true" style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              id="view-name"
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. P1 Open Tickets"
              aria-required="true"
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'view-name-error' : undefined}
              maxLength={100}
              style={{
                padding: '9px 12px',
                borderRadius: 6,
                border: `1px solid ${nameError ? '#ef4444' : 'var(--color-border, #d1d5db)'}`,
                fontSize: 14,
                color: 'var(--color-fg-primary, #111827)',
                background: 'var(--color-bg-input, #fff)',
              }}
            />
            {nameError && (
              <p id="view-name-error" role="alert" style={{ margin: 0, fontSize: 12, color: '#ef4444' }}>
                {nameError}
              </p>
            )}
          </div>

          {/* Scope selector */}
          <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <legend style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-fg-secondary, #374151)', marginBottom: 4 }}>
              Visibility
            </legend>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="radio"
                name="scope"
                value="private"
                checked={scope === 'private'}
                onChange={() => setScope('private')}
                style={{ marginTop: 2 }}
              />
              <span>
                <strong>Private</strong> — only visible to you
              </span>
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                cursor: canCreateShared ? 'pointer' : 'not-allowed',
                fontSize: 13,
                opacity: canCreateShared ? 1 : 0.5,
              }}
            >
              <input
                type="radio"
                name="scope"
                value="shared"
                checked={scope === 'shared'}
                onChange={() => setScope('shared')}
                disabled={!canCreateShared}
                style={{ marginTop: 2 }}
              />
              <span>
                <strong>Shared</strong> — visible to all agents
                {!canCreateShared && <span style={{ color: '#6b7280', marginLeft: 6 }}>(requires manager role)</span>}
              </span>
            </label>
          </fieldset>

          {/* Summary */}
          {currentFilter && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-muted, #6b7280)', background: 'var(--color-bg-alt, #f9fafb)', padding: '6px 10px', borderRadius: 4 }}>
              This view will capture the current active filters.
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 18px',
                borderRadius: 6,
                border: '1px solid var(--color-border, #d1d5db)',
                background: 'transparent',
                fontSize: 13,
                cursor: 'pointer',
                color: 'var(--color-fg-secondary, #374151)',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createView.isPending}
              style={{
                padding: '8px 18px',
                borderRadius: 6,
                border: 'none',
                background: createView.isPending ? '#a5b4fc' : 'var(--color-primary, #4f46e5)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: createView.isPending ? 'wait' : 'pointer',
              }}
            >
              {createView.isPending ? 'Saving…' : 'Save View'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
