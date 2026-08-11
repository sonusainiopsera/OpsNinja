'use client';

import React from 'react';
import { GlobalSearch } from './GlobalSearch';
import { LiveStatusPill } from './LiveStatusPill';
import { ExportMenu } from './ExportMenu';
import { UserMenu } from './UserMenu';
import { UserMenuSkeleton } from './ShellSkeletons';
import type { Principal } from '../../lib/api/identity';

interface TopBarProps {
  principal: Principal | null;
  onSignOut: () => void;
  onMobileMenuOpen?: () => void;
  theme?: 'light' | 'dark';
  onThemeToggle?: () => void;
}

export function TopBar({ principal, onSignOut, onMobileMenuOpen, theme = 'light', onThemeToggle }: TopBarProps) {
  return (
    <header
      role="banner"
      style={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 16px',
        borderBottom: '1px solid var(--color-border, #e5e7eb)',
        background: 'var(--color-bg-topbar, #fff)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        flexShrink: 0,
      }}
    >
      {/* Mobile menu toggle */}
      {onMobileMenuOpen && (
        <button
          aria-label="Open navigation menu"
          aria-haspopup="dialog"
          onClick={onMobileMenuOpen}
          className="mobile-menu-btn"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 18,
            padding: '4px 8px',
            color: 'var(--color-fg-primary, #111827)',
            display: 'none', // shown via CSS media query in globals
          }}
        >
          ☰
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 12 }}>
        <GlobalSearch />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <LiveStatusPill />

        <ExportMenu />

        {/* Theme toggle */}
        <button
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          aria-pressed={theme === 'dark'}
          onClick={onThemeToggle}
          data-testid="theme-toggle"
          style={{
            background: 'none',
            border: '1px solid var(--color-border, #d1d5db)',
            borderRadius: 6,
            padding: '5px 10px',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>

        {/* User menu */}
        {principal ? (
          <UserMenu principal={principal} onSignOut={onSignOut} />
        ) : (
          <UserMenuSkeleton />
        )}
      </div>
    </header>
  );
}
