'use client';

import React, { useRef, useState } from 'react';
import { useExportContext, type ExportFormat } from '@/lib/export/ExportContext';

export function ExportMenu() {
  const { handler, dispatch, isDispatching, lastError } = useExportContext();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const disabled = !handler || isDispatching;

  const handleSelect = async (format: ExportFormat) => {
    setOpen(false);
    await dispatch(format);
  };

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={disabled ? 'Export (not available on this page)' : 'Export page data'}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        data-testid="export-menu-button"
        title={!handler ? 'Export is not available on this page' : undefined}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          padding: '0.375rem 0.75rem',
          background: 'var(--color-surface-alt, #f3f4f6)',
          border: '1px solid var(--color-border, #e5e7eb)',
          borderRadius: '0.375rem',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: '0.875rem',
          fontWeight: 500,
          opacity: disabled ? 0.5 : 1,
          color: 'var(--color-text, #374151)',
        }}
      >
        <span aria-hidden="true">⬇</span>
        <span>Export</span>
      </button>

      {open && (
        <ul
          role="menu"
          aria-label="Export options"
          data-testid="export-menu-options"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '0.25rem',
            zIndex: 50,
            listStyle: 'none',
            padding: '0.25rem',
            margin: 0,
            background: 'var(--color-surface, #fff)',
            border: '1px solid var(--color-border, #e5e7eb)',
            borderRadius: '0.375rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minWidth: '9rem',
          }}
        >
          {(['pdf', 'csv'] as ExportFormat[]).map(fmt => (
            <li key={fmt} role="none">
              <button
                role="menuitem"
                onClick={() => handleSelect(fmt)}
                data-testid={`export-option-${fmt}`}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  borderRadius: '0.25rem',
                  color: 'var(--color-text, #374151)',
                }}
              >
                Export as {fmt.toUpperCase()}
              </button>
            </li>
          ))}
        </ul>
      )}

      {lastError && (
        <div
          role="alert"
          data-testid="export-error"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '0.25rem',
            zIndex: 50,
            padding: '0.5rem 0.75rem',
            background: 'var(--color-sla-breached-bg, #fee2e2)',
            color: 'var(--color-sla-breached-text, #991b1b)',
            borderRadius: '0.375rem',
            fontSize: '0.75rem',
            whiteSpace: 'nowrap',
          }}
        >
          {lastError}
        </div>
      )}
    </div>
  );
}
