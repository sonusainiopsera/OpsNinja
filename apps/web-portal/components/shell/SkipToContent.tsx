'use client';

import React from 'react';

export function SkipToContent() {
  return (
    <a
      href="#portal-main"
      style={{
        position: 'absolute',
        top: -9999,
        left: 8,
        zIndex: 9999,
        padding: '8px 16px',
        background: 'var(--portal-bg-primary, #fff)',
        color: 'var(--portal-accent, #0ea5e9)',
        fontWeight: 600,
        borderRadius: 4,
        border: '2px solid var(--portal-accent, #0ea5e9)',
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
