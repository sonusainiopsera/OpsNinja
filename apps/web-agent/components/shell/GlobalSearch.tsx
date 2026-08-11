'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * GlobalSearch — focuses when the user presses Ctrl+K (or Cmd+K on Mac).
 */
export function GlobalSearch() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      role="search"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <input
        ref={inputRef}
        type="search"
        placeholder="Search tickets, orgs…"
        aria-label="Global search (Ctrl+K)"
        data-testid="global-search"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          padding: '0.375rem 0.75rem',
          paddingRight: '2.5rem',
          background: 'var(--color-surface-alt, #f3f4f6)',
          border: `1px solid ${focused ? 'var(--color-accent, #4f46e5)' : 'var(--color-border, #e5e7eb)'}`,
          borderRadius: '0.375rem',
          fontSize: '0.875rem',
          width: '16rem',
          outline: 'none',
          color: 'var(--color-text, #111827)',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          right: '0.5rem',
          fontSize: '0.65rem',
          color: 'var(--color-muted, #9ca3af)',
          pointerEvents: 'none',
          fontFamily: 'monospace',
          padding: '0.1rem 0.3rem',
          background: 'var(--color-surface, #fff)',
          borderRadius: '0.2rem',
          border: '1px solid var(--color-border, #e5e7eb)',
        }}
      >
        ⌘K
      </span>
    </div>
  );
}
