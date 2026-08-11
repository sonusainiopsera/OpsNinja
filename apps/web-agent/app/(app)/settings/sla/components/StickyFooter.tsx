'use client';

/**
 * StickyFooter — save / discard actions with optimistic-concurrency version,
 * in-flight disabling, change-audit note, and 409 conflict banner.
 */

import React from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { SlaPolicyFormValues } from '../../../../lib/api/sla/types';

interface StickyFooterProps {
  form: UseFormReturn<SlaPolicyFormValues>;
  onSave: () => void;
  onDiscard: () => void;
  isSaving: boolean;
  isReadOnly: boolean;
  conflictError: string | null;
  onReloadAndMerge?: () => void;
}

export function StickyFooter({
  form,
  onSave,
  onDiscard,
  isSaving,
  isReadOnly,
  conflictError,
  onReloadAndMerge,
}: StickyFooterProps) {
  const { register, formState: { isDirty } } = form;

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        background: 'var(--color-bg-card, #fff)',
        borderTop: '1px solid var(--color-border, #e5e7eb)',
        padding: '12px 24px',
        zIndex: 10,
      }}
    >
      {/* 409 conflict banner */}
      {conflictError && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            padding: '10px 14px',
            marginBottom: 12,
            borderRadius: 6,
            background: 'var(--color-warning-surface, #fef3c7)',
            border: '1px solid var(--color-warning, #f59e0b)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            fontSize: 13,
            color: 'var(--color-warning, #92400e)',
          }}
        >
          <span>
            <strong>Version conflict:</strong> {conflictError} Your unsaved changes are preserved.
          </span>
          {onReloadAndMerge && (
            <button
              type="button"
              onClick={onReloadAndMerge}
              style={{
                padding: '4px 12px',
                borderRadius: 4,
                border: '1px solid var(--color-warning, #f59e0b)',
                background: 'none',
                color: 'var(--color-warning, #92400e)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Reload latest
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {/* Change audit note */}
        {!isReadOnly && (
          <input
            type="text"
            placeholder="Describe this change (recorded with actor and timestamp)"
            aria-label="Change audit note"
            disabled={isSaving}
            style={{
              flex: 1,
              minWidth: 240,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid var(--color-border, #e5e7eb)',
              fontSize: 13,
              color: 'var(--color-fg-primary, #111827)',
              background: isSaving ? 'var(--color-surface-2, #f3f4f6)' : 'var(--color-bg-card, #fff)',
            }}
            {...register('changeAuditNote')}
          />
        )}

        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
          {/* Discard */}
          {!isReadOnly && (
            <button
              type="button"
              onClick={onDiscard}
              disabled={isSaving || !isDirty}
              aria-label="Discard unsaved changes"
              style={{
                padding: '7px 16px',
                borderRadius: 6,
                border: '1px solid var(--color-border, #e5e7eb)',
                background: 'none',
                color: 'var(--color-fg-secondary, #6b7280)',
                fontSize: 13,
                fontWeight: 500,
                cursor: isSaving || !isDirty ? 'not-allowed' : 'pointer',
                opacity: isSaving || !isDirty ? 0.5 : 1,
              }}
            >
              Discard
            </button>
          )}

          {/* Save */}
          {!isReadOnly && (
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              aria-label={isSaving ? 'Saving…' : 'Save policy'}
              aria-busy={isSaving}
              style={{
                padding: '7px 20px',
                borderRadius: 6,
                border: 'none',
                background: isSaving
                  ? 'var(--color-primary-muted, #a5b4fc)'
                  : 'var(--color-primary, #4f46e5)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: isSaving ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {isSaving && (
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: 12,
                    height: 12,
                    border: '2px solid rgba(255,255,255,0.4)',
                    borderTopColor: '#fff',
                    borderRadius: '50%',
                    animation: 'spin 0.7s linear infinite',
                  }}
                />
              )}
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          )}

          {isReadOnly && (
            <span
              role="status"
              style={{
                padding: '7px 14px',
                borderRadius: 6,
                background: 'var(--color-surface-2, #f3f4f6)',
                fontSize: 13,
                color: 'var(--color-fg-secondary, #6b7280)',
              }}
            >
              Read-only — insufficient permissions
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
