'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { PortalPrincipal } from '../../lib/identity/usePortalIdentity';

interface PortalUserMenuProps {
  principal: PortalPrincipal;
}

export function PortalUserMenu({ principal }: PortalUserMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  async function handleSignOut() {
    await fetch('/api/portal/v1/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login';
  }

  const initials = principal.name
    .split(' ')
    .map(p => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="portal-user-menu-trigger"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: 'none',
          border: '1px solid var(--color-border, #e5e7eb)',
          borderRadius: '9999px',
          padding: '0.25rem 0.75rem 0.25rem 0.25rem',
          cursor: 'pointer',
          color: 'var(--color-text, #111827)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: '1.75rem',
            height: '1.75rem',
            borderRadius: '9999px',
            background: 'var(--color-accent, #4f46e5)',
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.75rem',
            fontWeight: 700,
          }}
        >
          {initials}
        </span>
        <span data-testid="portal-user-name" style={{ fontSize: '0.875rem', fontWeight: 500 }}>
          {principal.name}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          data-testid="portal-user-menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 0.5rem)',
            minWidth: '16rem',
            background: 'var(--color-surface, #fff)',
            border: '1px solid var(--color-border, #e5e7eb)',
            borderRadius: '0.5rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 200,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '0.75rem 1rem',
              borderBottom: '1px solid var(--color-border, #e5e7eb)',
            }}
          >
            <div
              data-testid="portal-user-menu-name"
              style={{ fontWeight: 600, fontSize: '0.875rem' }}
            >
              {principal.name}
            </div>
            <div
              data-testid="portal-user-menu-email"
              style={{ fontSize: '0.8125rem', color: 'var(--color-muted, #6b7280)' }}
            >
              {principal.email}
            </div>
          </div>
          <button
            role="menuitem"
            onClick={handleSignOut}
            data-testid="portal-sign-out"
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '0.625rem 1rem',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: 'var(--color-danger, #dc2626)',
              fontWeight: 500,
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
