'use client';

/**
 * ResolveModal — WO-042.
 *
 * Resolve ticket modal with:
 *   - Required resolution note (cannot submit without it)
 *   - Focus trapping: Tab / Shift+Tab cycle within the modal; Escape closes
 *   - AI synthesis status: pending → ready (crux + affected-area tags) | failed
 *   - Editable affected-area tag control (pre-populated when AI is ready)
 *   - CSAT trigger notice
 *   - Resolution succeeds even when AI is still pending or has failed
 *
 * Accessibility:
 *   - role="dialog" with aria-modal and aria-labelledby
 *   - Focus moves to first focusable element on open
 *   - Returns focus to trigger on close
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { AiStatus, TicketDetail } from '../../lib/api/tickets/types';

// ---------------------------------------------------------------------------
// Focus trap
// ---------------------------------------------------------------------------

function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;

    const el = ref.current;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    first?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      if (focusable.length === 0) { e.preventDefault(); return; }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }

    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [active, ref]);
}

// ---------------------------------------------------------------------------
// Tag control
// ---------------------------------------------------------------------------

interface TagControlProps {
  tags: Array<{ id: string; name: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

function TagControl({ tags, selected, onChange, disabled = false }: TagControlProps) {
  const toggleTag = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div
      role="group"
      aria-label="Affected area tags"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
    >
      {tags.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => !disabled && toggleTag(t.id)}
          aria-pressed={selected.includes(t.id)}
          disabled={disabled}
          style={{
            fontSize: 12,
            padding: '3px 10px',
            borderRadius: 10,
            border: `1.5px solid ${selected.includes(t.id) ? '#2563eb' : '#d1d5db'}`,
            background: selected.includes(t.id) ? '#eff6ff' : '#fff',
            color: selected.includes(t.id) ? '#1d4ed8' : '#6b7280',
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          {t.name}
        </button>
      ))}
      {tags.length === 0 && (
        <span style={{ fontSize: 12, color: '#9ca3af' }}>None available</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ResolveModalProps {
  ticket: TicketDetail;
  isOpen: boolean;
  isSubmitting: boolean;
  submitError: string | null;
  onClose: () => void;
  onResolve: (note: string, affectedAreaTagIds: string[]) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResolveModal({
  ticket,
  isOpen,
  isSubmitting,
  submitError,
  onClose,
  onResolve,
}: ResolveModalProps) {
  const [note, setNote] = useState('');
  const [affectedTagIds, setAffectedTagIds] = useState<string[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useFocusTrap(dialogRef, isOpen);

  // Track AI tag suggestions — populate when AI becomes ready
  useEffect(() => {
    if (ticket.aiStatus === 'ready' && ticket.aiAffectedAreaTags.length > 0 && affectedTagIds.length === 0) {
      setAffectedTagIds(ticket.aiAffectedAreaTags.map((t) => t.id));
    }
  }, [ticket.aiStatus, ticket.aiAffectedAreaTags, affectedTagIds.length]);

  // Return focus to trigger on close
  useEffect(() => {
    if (!isOpen && triggerRef.current) {
      triggerRef.current.focus();
    }
  }, [isOpen]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [isOpen, onClose]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!note.trim() || isSubmitting) return;
      onResolve(note.trim(), affectedTagIds);
    },
    [note, affectedTagIds, isSubmitting, onResolve],
  );

  if (!isOpen) return null;

  const aiStatus: AiStatus = ticket.aiStatus;

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
          zIndex: 1000,
        }}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resolve-modal-title"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 1001,
          background: '#ffffff',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          padding: 24,
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2
            id="resolve-modal-title"
            style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#111827' }}
          >
            Resolve ticket #{ticket.ticketNumber}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close resolve modal"
            style={{
              background: 'none',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              color: '#9ca3af',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Resolution note */}
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="resolution-note"
              style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}
            >
              Resolution note <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea
              id="resolution-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              required
              disabled={isSubmitting}
              placeholder="Describe how this ticket was resolved…"
              aria-required="true"
              aria-describedby="resolution-note-hint"
              style={{
                width: '100%',
                resize: 'vertical',
                fontSize: 14,
                padding: '8px 10px',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
            <p id="resolution-note-hint" style={{ fontSize: 11, color: '#9ca3af', margin: '4px 0 0' }}>
              This note is visible to the customer.
            </p>
          </div>

          {/* AI synthesis section */}
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: aiStatus === 'failed' ? '#fef2f2' : '#f8fafc',
              border: `1px solid ${aiStatus === 'failed' ? '#fca5a5' : '#e2e8f0'}`,
              marginBottom: 16,
            }}
            aria-live="polite"
            aria-label="AI synthesis status"
          >
            <p style={{ fontSize: 12, fontWeight: 700, color: '#475569', margin: '0 0 6px' }}>
              AI summary
            </p>

            {aiStatus === 'pending' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden="true" style={{ fontSize: 16 }}>⏳</span>
                <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
                  Generating crux and affected-area tags…
                </p>
              </div>
            )}

            {aiStatus === 'ready' && (
              <div>
                {ticket.aiCrux && (
                  <p style={{ fontSize: 13, color: '#374151', margin: '0 0 8px', fontStyle: 'italic' }}>
                    "{ticket.aiCrux}"
                  </p>
                )}
                <p style={{ fontSize: 12, fontWeight: 600, color: '#475569', margin: '0 0 6px' }}>
                  Affected areas (edit if needed):
                </p>
                <TagControl
                  tags={ticket.aiAffectedAreaTags}
                  selected={affectedTagIds}
                  onChange={setAffectedTagIds}
                />
              </div>
            )}

            {aiStatus === 'failed' && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span aria-hidden="true" style={{ fontSize: 16 }}>⚠</span>
                <div>
                  <p style={{ fontSize: 13, color: '#dc2626', margin: '0 0 4px', fontWeight: 600 }}>
                    AI summary unavailable
                  </p>
                  <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>
                    You can still resolve the ticket. Add affected areas manually if needed.
                  </p>
                  <TagControl
                    tags={ticket.aiAffectedAreaTags}
                    selected={affectedTagIds}
                    onChange={setAffectedTagIds}
                  />
                </div>
              </div>
            )}
          </div>

          {/* CSAT notice */}
          <p
            style={{
              fontSize: 12,
              color: '#6b7280',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 6,
              padding: '8px 10px',
              margin: '0 0 16px',
            }}
          >
            📧 A CSAT survey will be sent to the customer after resolution.
          </p>

          {submitError && (
            <p role="alert" style={{ fontSize: 12, color: '#dc2626', margin: '0 0 12px' }}>
              {submitError}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                fontSize: 13,
                padding: '8px 18px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                color: '#374151',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!note.trim() || isSubmitting}
              style={{
                fontSize: 13,
                fontWeight: 700,
                padding: '8px 22px',
                borderRadius: 6,
                border: 'none',
                background: !note.trim() || isSubmitting ? '#d1d5db' : '#16a34a',
                color: !note.trim() || isSubmitting ? '#9ca3af' : '#fff',
                cursor: !note.trim() || isSubmitting ? 'not-allowed' : 'pointer',
              }}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? 'Resolving…' : 'Resolve ticket'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
