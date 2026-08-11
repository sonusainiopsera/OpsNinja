'use client';

/**
 * PortalHeader — public-facing portal header.
 *
 * Contains: org logo + initials fallback, read-only OrgScopePill,
 * HelpLink, theme toggle, PortalUserMenu.
 *
 * NO Sidebar, TenantSwitcher, GlobalSearch, LiveStatusPill or ExportMenu.
 */

import React from 'react';
import { OrgScopePill } from './OrgScopePill';
import { HelpLink } from './HelpLink';
import { PortalUserMenu } from './PortalUserMenu';
import type { PortalPrincipal } from '../../lib/api/client';

interface PortalHeaderProps {
  principal: PortalPrincipal | null;
  theme?: 'light' | 'dark';
  onThemeToggle?: () => void;
}

function OrgLogo({ principal }: { principal: PortalPrincipal }) {
  const { organization } = principal;
  const initials = organization.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  if (organization.logoUrl) {
    return (
      <img
        src={organization.logoUrl}
        alt={`${organization.name} logo`}
        style={{ height: 32, objectFit: 'contain', maxWidth: 100 }}
        onError={(e) => {
          // Fallback to initials on image load failure
          const target = e.currentTarget as HTMLImageElement;
          target.style.display = 'none';
          const sibling = target.nextSibling as HTMLElement | null;
          if (sibling) sibling.style.display = 'inline-flex';
        }}
      />
    );
  }

  return (
    <span
      aria-label={`${organization.name} logo`}
      style={{
        width: 32,
        height: 32,
        borderRadius: 6,
        background: 'var(--portal-accent, #0ea5e9)',
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {initials}
    </span>
  );
}

function HeaderSkeleton() {
  return (
    <div style={{ width: 120, height: 28, borderRadius: 6, background: 'var(--portal-bg-alt, #f3f4f6)' }} />
  );
}

export function PortalHeader({ principal, theme = 'light', onThemeToggle }: PortalHeaderProps) {
  return (
    <header
      role="banner"
      style={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 20px',
        borderBottom: '1px solid var(--portal-border, #e5e7eb)',
        background: 'var(--portal-bg-header, #fff)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      {/* Org logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {principal ? <OrgLogo principal={principal} /> : <HeaderSkeleton />}
      </div>

      {/* Org scope pill */}
      {principal && (
        <OrgScopePill organization={principal.organization} />
      )}

      <div style={{ flex: 1 }} />

      {/* Right-side actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <HelpLink />

        {/* Theme toggle */}
        <button
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          aria-pressed={theme === 'dark'}
          onClick={onThemeToggle}
          data-testid="portal-theme-toggle"
          style={{
            background: 'none',
            border: '1px solid var(--portal-border, #d1d5db)',
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
          <PortalUserMenu principal={principal} />
        ) : (
          <div
            aria-label="Loading user"
            style={{
              width: 80,
              height: 28,
              borderRadius: 6,
              background: 'var(--portal-bg-alt, #f3f4f6)',
            }}
          />
        )}
      </div>
    </header>
  );
}
