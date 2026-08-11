'use client';

/**
 * SkipToContent — first focusable element in the document.
 * Hidden until focused; click/Enter jumps to the #main-content landmark.
 */

import React from 'react';

export function SkipToContent() {
  return (
    <a
      href="#main-content"
      style={{
        position: 'absolute',
        top: -9999,
        left: 8,
        zIndex: 9999,
        padding: '8px 16px',
        background: 'var(--color-bg-primary, #fff)',
        color: 'var(--color-accent, #4f46e5)',
        fontWeight: 600,
        borderRadius: 4,
        border: '2px solid var(--color-accent, #4f46e5)',
        textDecoration: 'none',
        outline: 'none',
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.top = '8px';
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.top = '-9999px';
      }}
    >
      Skip to main content
    </a>
  );
}
