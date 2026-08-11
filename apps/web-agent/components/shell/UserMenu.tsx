'use client';

/**
 * UserMenu — signed-in principal name, email, role and sign-out.
 * Long names and emails truncate accessibly.
 */

import React, { useRef, useState } from 'react';
import type { Principal } from '../../lib/api/identity';

interface UserMenuProps {
  principal: Principal;
  onSignOut: () => void;
}

export function UserMenu({ principal, onSignOut }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = 'user-menu';

  const initials = principal.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        id="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`User menu: ${principal.name}`}
        onClick={() => setOpen((o) => !o)}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) {
            setOpen(false);
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderRadius: 9999,
          border: '1px solid transparent',
          background: 'none',
          cursor: 'pointer',
        }}
      >
        {principal.avatarUrl ? (
          <img
            src={principal.avatarUrl}
            alt=""
            style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <span
            aria-hidden="true"
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'var(--color-accent, #4f46e5)',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {initials}
          </span>
        )}
        <span
          aria-hidden="true"
          style={{
            fontSize: 13,
            fontWeight: 500,
            maxWidth: 120,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--color-fg-primary, #111827)',
          }}
        >
          {principal.name}
        </span>
        <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--color-muted, #9ca3af)' }}>▾</span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="User options"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: 'var(--color-bg-primary, #fff)',
            border: '1px solid var(--color-border, #d1d5db)',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minWidth: 200,
            zIndex: 100,
          }}
        >
          {/* Identity info — not interactive */}
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--color-border, #d1d5db)',
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                maxWidth: 170,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--color-fg-primary, #111827)',
              }}
              title={principal.name}
            >
              {principal.name}
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-muted, #6b7280)',
                maxWidth: 170,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 2,
              }}
              title={principal.email}
            >
              {principal.email}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-muted, #9ca3af)', marginTop: 4, textTransform: 'capitalize' }}>
              {principal.role.replace('_', ' ')}
            </div>
          </div>

          <div role="none" style={{ padding: '4px 0' }}>
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              data-testid="sign-out-btn"
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 16px',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--color-error-fg, #991b1b)',
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = 'var(--color-bg-hover, #f3f4f6)')
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
