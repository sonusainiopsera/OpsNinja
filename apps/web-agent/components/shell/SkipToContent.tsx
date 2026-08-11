'use client';

import React from 'react';

/**
 * SkipToContent — first focusable element on every page.
 * Visually hidden until focused, then slides into view.
 * Links to #main-content which must be present on the page.
 */
export function SkipToContent() {
  return (
    <a
      href="#main-content"
      data-testid="skip-to-content"
      style={{
        position: 'absolute',
        top: '-9999px',
        left: '-9999px',
        zIndex: 9999,
        padding: '0.5rem 1rem',
        background: 'var(--color-surface, #fff)',
        color: 'var(--color-accent, #4f46e5)',
        fontWeight: 600,
        textDecoration: 'none',
        borderRadius: '0.25rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onFocus={e => {
        (e.currentTarget as HTMLElement).style.top = '0.5rem';
        (e.currentTarget as HTMLElement).style.left = '0.5rem';
      }}
      onBlur={e => {
        (e.currentTarget as HTMLElement).style.top = '-9999px';
        (e.currentTarget as HTMLElement).style.left = '-9999px';
      }}
    >
      Skip to main content
    </a>
  );
}
