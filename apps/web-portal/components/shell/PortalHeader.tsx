'use client';

import React, { useState, useEffect } from 'react';
import type { PortalPrincipal, PortalOrg } from '../../lib/identity/usePortalIdentity';
import { OrgScopePill } from './OrgScopePill';
import { HelpLink } from './HelpLink';
import { PortalUserMenu } from './PortalUserMenu';

interface PortalHeaderProps {
  principal: PortalPrincipal;
  org: PortalOrg;
}

function OrgLogo({ org }: { org: PortalOrg }) {
  const [imgError, setImgError] = useState(false);

  const initials = org.name
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  if (org.logoUrl && !imgError) {
    return (
      <img
        src={org.logoUrl}
        alt={org.name}
        data-testid="org-logo"
        onError={() => setImgError(true)}
        style={{ height: '2rem', maxWidth: '7rem', objectFit: 'contain' }}
      />
    );
  }

  return (
    <span
      aria-label={org.name}
      data-testid="org-logo-initials"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '2rem',
        height: '2rem',
        borderRadius: '0.375rem',
        background: 'var(--color-accent, #4f46e5)',
        color: '#fff',
        fontWeight: 700,
        fontSize: '0.875rem',
      }}
    >
      {initials}
    </span>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = (() => {
      try {
        return localStorage.getItem('opsninja.portal.theme');
      } catch {
        return null;
      }
    })();
    if (stored === 'dark' || stored === 'light') {
      setTheme(stored);
      document.documentElement.setAttribute('data-theme', stored);
    }
  }, []);

  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('opsninja.portal.theme', next);
    } catch {
      // localStorage unavailable
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      data-testid="theme-toggle"
      data-theme={theme}
      style={{
        background: 'none',
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: '0.375rem',
        padding: '0.375rem 0.5rem',
        cursor: 'pointer',
        color: 'var(--color-text, #111827)',
        fontSize: '1rem',
      }}
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}

export function PortalHeader({ principal, org }: PortalHeaderProps) {
  return (
    <header
      role="banner"
      data-testid="portal-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0 1.5rem',
        height: '3.5rem',
        background: 'var(--color-surface, #fff)',
        borderBottom: '1px solid var(--color-border, #e5e7eb)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        minWidth: 0,
      }}
    >
      {/* Brand / org identity */}
      <OrgLogo org={org} />
      <OrgScopePill orgName={org.name} />

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      <HelpLink />
      <ThemeToggle />
      <PortalUserMenu principal={principal} />
    </header>
  );
}
