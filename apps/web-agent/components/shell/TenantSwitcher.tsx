'use client';

/**
 * TenantSwitcher — organization scope selector.
 *
 * Single-org principals: static read-only scope indicator.
 * Multi-org principals: searchable dropdown picker.
 * Truncates very long org names accessibly.
 */

import React, { useState, useId } from 'react';
import { OrgChip } from '@opsninja/ui-kit';
import type { OrgScope } from '../../lib/api/identity';

interface TenantSwitcherProps {
  current: OrgScope | null;
  available: OrgScope[];
  onSelect?: (org: OrgScope) => void;
}

export function TenantSwitcher({ current, available, onSelect }: TenantSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputId = useId();

  const isSingle = available.length <= 1;

  if (!current) {
    return (
      <div
        aria-label="No organization in scope"
        style={{ padding: '6px 8px', fontSize: 12, color: 'var(--color-muted, #9ca3af)' }}
      >
        No organization
      </div>
    );
  }

  if (isSingle) {
    return (
      <div aria-label={`Current organization: ${current.name}`} data-testid="tenant-switcher-static">
        <OrgChip name={current.name} avatarUrl={current.avatarUrl} />
      </div>
    );
  }

  const filtered = available.filter((o) =>
    o.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div style={{ position: 'relative' }} data-testid="tenant-switcher-picker">
      <button
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Organization: ${current.name}. Click to switch.`}
        onClick={() => setOpen((o) => !o)}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) {
            setOpen(false);
            setQuery('');
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'none',
          border: '1px solid var(--color-border, #d1d5db)',
          borderRadius: 6,
          padding: '4px 8px',
          cursor: 'pointer',
        }}
      >
        <OrgChip name={current.name} avatarUrl={current.avatarUrl} maxLength={16} />
        <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--color-muted, #9ca3af)' }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: 'var(--color-bg-primary, #fff)',
            border: '1px solid var(--color-border, #d1d5db)',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            minWidth: 220,
            zIndex: 100,
          }}
        >
          <div style={{ padding: '8px 8px 4px' }}>
            <input
              id={inputId}
              type="search"
              placeholder="Search organizations…"
              aria-label="Search organizations"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                border: '1px solid var(--color-border, #d1d5db)',
                borderRadius: 6,
                fontSize: 12,
                boxSizing: 'border-box',
              }}
              autoFocus
            />
          </div>
          <ul
            role="listbox"
            aria-label="Organizations"
            style={{
              listStyle: 'none',
              padding: '4px 0',
              margin: 0,
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {filtered.length === 0 && (
              <li style={{ padding: '8px 16px', fontSize: 12, color: 'var(--color-muted, #9ca3af)' }}>
                No results
              </li>
            )}
            {filtered.map((org) => (
              <li key={org.id} role="option" aria-selected={org.id === current.id}>
                <button
                  onClick={() => {
                    onSelect?.(org);
                    setOpen(false);
                    setQuery('');
                  }}
                  style={{
                    display: 'flex',
                    width: '100%',
                    padding: '6px 12px',
                    alignItems: 'center',
                    gap: 8,
                    background: org.id === current.id ? 'var(--color-bg-alt,#f3f4f6)' : 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'var(--color-bg-hover,#f3f4f6)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background =
                      org.id === current.id ? 'var(--color-bg-alt,#f3f4f6)' : 'none')
                  }
                >
                  <OrgChip name={org.name} avatarUrl={org.avatarUrl} maxLength={24} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
