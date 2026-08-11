'use client';

import React, { useCallback, useEffect, useRef } from 'react';

const SHORTCUT_KEY = '/';

export function GlobalSearch() {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Focus search on '/' key when not already in an input/textarea
    const active = document.activeElement;
    const isEditing =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active as HTMLElement)?.isContentEditable;

    if (e.key === SHORTCUT_KEY && !isEditing) {
      e.preventDefault();
      inputRef.current?.focus();
    }

    if (e.key === 'Escape' && document.activeElement === inputRef.current) {
      inputRef.current?.blur();
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      role="search"
      aria-label="Global search"
      style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
    >
      <input
        ref={inputRef}
        type="search"
        placeholder={`Search tickets… (${SHORTCUT_KEY})`}
        aria-label="Search tickets"
        aria-keyshortcuts="/"
        style={{
          padding: '6px 12px 6px 32px',
          borderRadius: 6,
          border: '1px solid var(--color-border, #d1d5db)',
          background: 'var(--color-bg-input, #f9fafb)',
          color: 'var(--color-fg-primary, #111827)',
          fontSize: 13,
          width: 220,
          outline: 'none',
        }}
        onFocus={(e) =>
          (e.currentTarget.style.border = '1px solid var(--color-accent, #4f46e5)')
        }
        onBlur={(e) =>
          (e.currentTarget.style.border = '1px solid var(--color-border, #d1d5db)')
        }
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 8,
          fontSize: 14,
          color: 'var(--color-muted, #9ca3af)',
          pointerEvents: 'none',
        }}
      >
        🔍
      </span>
    </div>
  );
}
