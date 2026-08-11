'use client';

import React from 'react';
import { GlobalSearch } from './GlobalSearch';
import { LiveStatusPill } from './LiveStatusPill';
import { ExportMenu } from './ExportMenu';
import { UserMenu } from './UserMenu';

interface TopBarProps {
  onMenuToggle?: () => void;
  showMenuButton?: boolean;
}

export function TopBar({ onMenuToggle, showMenuButton = false }: TopBarProps) {
  return (
    <header
      role="banner"
      data-testid="top-bar"
      style={{
        height: '3.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        padding: '0 1rem',
        background: 'var(--color-surface, #fff)',
        borderBottom: '1px solid var(--color-border, #e5e7eb)',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        zIndex: 30,
      }}
    >
      {/* Left: mobile menu toggle + search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {showMenuButton && (
          <button
            aria-label="Open navigation menu"
            onClick={onMenuToggle}
            data-testid="mobile-menu-button"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1.25rem',
              padding: '0.25rem',
              color: 'var(--color-text, #374151)',
            }}
          >
            ☰
          </button>
        )}
        <GlobalSearch />
      </div>

      {/* Right: status + export + theme + user */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <LiveStatusPill />
        <ExportMenu />
        {/* Theme toggle slot — placeholder wired to WOREF-017 theme provider */}
        <button
          aria-label="Toggle theme"
          data-testid="theme-toggle"
          style={{
            background: 'none',
            border: '1px solid var(--color-border, #e5e7eb)',
            borderRadius: '0.375rem',
            cursor: 'pointer',
            padding: '0.375rem 0.5rem',
            fontSize: '1rem',
            color: 'var(--color-text, #374151)',
          }}
          onClick={() => {
            // Theme toggle wired to WOREF-017 ThemeProvider
            const html = document.documentElement;
            const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', next);
            try {
              localStorage.setItem('opsninja.theme', next);
            } catch { /* ignore */ }
          }}
        >
          ☀
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
