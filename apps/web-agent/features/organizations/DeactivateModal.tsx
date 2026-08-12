'use client';

/**
 * DeactivateModal — requires administrator to type the organization name
 * before deactivation can proceed. Mirrors the API contract's confirmation
 * requirement and prevents accidental deactivation.
 *
 * On success: the caller receives the updated org so the table cache can
 * reflect the new inactive status without a manual refresh.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Organization } from '../../lib/api/organizations/types';
import { useDeactivateOrganization } from '../../lib/api/organizations/hooks';

interface DeactivateModalProps {
  org: Organization;
  onClose: () => void;
  onSuccess: (updatedOrg: Organization) => void;
}

export function DeactivateModal({ org, onClose, onSuccess }: DeactivateModalProps) {
  const deactivateMutation = useDeactivateOrganization(org.id);
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Keyboard: Escape closes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const nameMatches = confirmName.trim() === org.name;

  const handleConfirm = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameMatches) {
      setError('Organization name does not match. Please type the exact name.');
      return;
    }
    setError(null);

    try {
      const updated = await deactivateMutation.mutateAsync();
      onSuccess(updated);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to deactivate organization');
    }
  }, [nameMatches, deactivateMutation, onSuccess]);

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 300,
        }}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deactivate-title"
        aria-describedby="deactivate-description"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'var(--color-bg-card, #fff)',
          borderRadius: 10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          zIndex: 301,
          width: 'min(480px, 95vw)',
          padding: 24,
        }}
      >
        {/* Warning icon */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: '#fee2e2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            marginBottom: 16,
          }}
          aria-hidden="true"
        >
          ⚠
        </div>

        <h2 id="deactivate-title" style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#111827' }}>
          Deactivate organization
        </h2>

        <p id="deactivate-description" style={{ fontSize: 14, color: '#374151', marginBottom: 20, lineHeight: 1.5 }}>
          Deactivating <strong>{org.name}</strong> will prevent new tickets from being created
          for this organization, disable portal access for all contacts, and archive the
          organization. This action can be reversed by reactivating.
        </p>

        <form onSubmit={handleConfirm} noValidate>
          <div style={{ marginBottom: 16 }}>
            <label
              htmlFor="confirm-name"
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 500,
                color: '#374151',
                marginBottom: 6,
              }}
            >
              To confirm, type <strong>{org.name}</strong> below:
            </label>
            <input
              ref={inputRef}
              id="confirm-name"
              type="text"
              value={confirmName}
              onChange={(e) => {
                setConfirmName(e.target.value);
                setError(null);
              }}
              placeholder={org.name}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'deactivate-error' : undefined}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: `1px solid ${error ? '#f87171' : 'var(--color-border, #d1d5db)'}`,
                fontSize: 14,
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            {error && (
              <p
                id="deactivate-error"
                role="alert"
                style={{ fontSize: 12, color: '#dc2626', marginTop: 5 }}
              >
                {error}
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              disabled={deactivateMutation.isPending || !nameMatches}
              style={{
                flex: 1,
                padding: '9px 0',
                borderRadius: 6,
                border: 'none',
                background: nameMatches ? '#dc2626' : '#fca5a5',
                color: '#fff',
                cursor: deactivateMutation.isPending || !nameMatches ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 500,
                transition: 'background 0.15s',
              }}
              aria-disabled={!nameMatches}
            >
              {deactivateMutation.isPending ? 'Deactivating…' : 'Deactivate organization'}
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
