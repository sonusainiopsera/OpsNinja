'use client';

import React, { useRef, useState } from 'react';
import { useCurrentPrincipal } from '@/lib/identity/useIdentity';

export function UserMenu() {
  const { data: principal, isLoading, isError } = useCurrentPrincipal();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const handleSignOut = async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      window.location.href = '/login';
    }
  };

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading user"
        data-testid="user-menu-skeleton"
        style={{
          width: '2rem',
          height: '2rem',
          borderRadius: '50%',
          background: 'var(--color-skeleton, #e5e7eb)',
        }}
      />
    );
  }

  if (isError || !principal) {
    return (
      <div
        data-testid="user-menu-error"
        style={{ fontSize: '0.75rem', color: 'var(--color-error, #ef4444)' }}
      >
        Sign in
      </div>
    );
  }

  const initials = principal.name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`User menu for ${principal.name}`}
        onClick={() => setOpen(o => !o)}
        data-testid="user-menu-button"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0.25rem',
          borderRadius: '9999px',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: '2rem',
            height: '2rem',
            borderRadius: '50%',
            background: 'var(--color-accent, #4f46e5)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.75rem',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initials}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="User menu"
          data-testid="user-menu-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '0.5rem',
            zIndex: 50,
            background: 'var(--color-surface, #fff)',
            border: '1px solid var(--color-border, #e5e7eb)',
            borderRadius: '0.5rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minWidth: '13rem',
            padding: '0.25rem',
          }}
        >
          {/* Identity summary */}
          <div
            style={{
              padding: '0.75rem',
              borderBottom: '1px solid var(--color-border, #e5e7eb)',
              marginBottom: '0.25rem',
            }}
          >
            <p
              data-testid="user-menu-name"
              style={{
                fontWeight: 600,
                fontSize: '0.875rem',
                margin: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={principal.name}
            >
              {principal.name}
            </p>
            <p
              data-testid="user-menu-email"
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-muted, #6b7280)',
                margin: '0.125rem 0 0',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={principal.email}
            >
              {principal.email}
            </p>
            <p
              data-testid="user-menu-role"
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-muted, #6b7280)',
                margin: '0.125rem 0 0',
                textTransform: 'capitalize',
              }}
            >
              {principal.role.replace('_', ' ')}
            </p>
          </div>

          <button
            role="menuitem"
            onClick={handleSignOut}
            data-testid="user-menu-sign-out"
            style={{
              display: 'block',
              width: '100%',
              padding: '0.5rem 0.75rem',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: 'var(--color-error, #ef4444)',
              borderRadius: '0.25rem',
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
