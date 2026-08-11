'use client';

/**
 * ExportMenu — dispatches to the current page's registered export handler.
 * Renders disabled with a tooltip when no handler is registered.
 */

import React, { useRef, useState } from 'react';
import { useExportContext, type ExportFormat } from '../../lib/context/ExportContext';

export function ExportMenu() {
  const { handler } = useExportContext();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = 'export-menu';
  const disabled = !handler;

  const handleExport = async (format: ExportFormat) => {
    if (!handler) return;
    setOpen(false);
    setError(null);
    try {
      await handler(format);
    } catch (err) {
      const traceId =
        err && typeof err === 'object' && 'error' in err
          ? (err as { error?: { traceId?: string } }).error?.traceId
          : null;
      setError(
        traceId
          ? `Export failed. Trace ID: ${traceId}`
          : 'Export failed. Please try again.',
      );
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-disabled={disabled}
        title={disabled ? 'No export available on this page' : 'Export data'}
        onClick={() => !disabled && setOpen((o) => !o)}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) {
            setOpen(false);
          }
        }}
        style={{
          padding: '6px 12px',
          borderRadius: 6,
          border: '1px solid var(--color-border, #d1d5db)',
          background: 'var(--color-bg-btn, #fff)',
          color: disabled
            ? 'var(--color-muted, #9ca3af)'
            : 'var(--color-fg-primary, #111827)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        Export ▾
      </button>
      {error && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            padding: '8px 12px',
            background: 'var(--color-error-bg, #fef2f2)',
            color: 'var(--color-error-fg, #991b1b)',
            fontSize: 12,
            borderRadius: 6,
            whiteSpace: 'nowrap',
            zIndex: 200,
          }}
        >
          {error}
        </div>
      )}
      {open && (
        <ul
          id={menuId}
          role="menu"
          aria-label="Export options"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            padding: '4px 0',
            background: 'var(--color-bg-primary, #fff)',
            border: '1px solid var(--color-border, #d1d5db)',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            listStyle: 'none',
            margin: 0,
            minWidth: 140,
            zIndex: 100,
          }}
        >
          {(['pdf', 'csv'] as ExportFormat[]).map((fmt) => (
            <li key={fmt} role="none">
              <button
                role="menuitem"
                onClick={() => handleExport(fmt)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '8px 16px',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: 'var(--color-fg-primary, #111827)',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = 'var(--color-bg-hover, #f3f4f6)')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = 'none')
                }
              >
                Export as {fmt.toUpperCase()}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
