'use client';

import React, { useState } from 'react';
import { useOrgScope } from '@/lib/identity/useIdentity';

interface TenantSwitcherProps {
  collapsed?: boolean;
}

/**
 * TenantSwitcher — shows current org scope.
 *
 * Single-org principals: read-only static indicator (no picker).
 * Multi-org principals: searchable dropdown to switch scope.
 * Degrades gracefully while scope data is loading.
 */
export function TenantSwitcher({ collapsed = false }: TenantSwitcherProps) {
  const { data: scope, isLoading, isError } = useOrgScope();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading organization"
        data-testid="tenant-switcher-skeleton"
        style={{
          padding: '0.5rem 0.75rem',
          height: '2.25rem',
          background: 'var(--color-skeleton, #e5e7eb)',
          borderRadius: '0.375rem',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      />
    );
  }

  if (isError || !scope) {
    return (
      <div
        data-testid="tenant-switcher-error"
        style={{
          padding: '0.5rem 0.75rem',
          fontSize: '0.75rem',
          color: 'var(--color-error, #ef4444)',
        }}
      >
        {collapsed ? '!' : 'Scope unavailable'}
      </div>
    );
  }

  const currentOrg = scope.organizations.find(o => o.id === scope.currentOrgId);
  const currentName = currentOrg?.name ?? 'Unknown';
  const isSingleOrg = scope.organizations.length === 1;

  if (collapsed) {
    return (
      <div
        title={currentName}
        aria-label={`Current organization: ${currentName}`}
        data-testid="tenant-switcher"
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
          margin: '0 auto',
        }}
      >
        {currentName.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  // Single org — static indicator, no picker
  if (isSingleOrg) {
    return (
      <div
        data-testid="tenant-switcher"
        data-single-org="true"
        style={{
          padding: '0.5rem 0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          borderRadius: '0.375rem',
          background: 'var(--color-surface-alt, #f3f4f6)',
        }}
      >
        <span
          style={{
            width: '1.25rem',
            height: '1.25rem',
            borderRadius: '50%',
            background: 'var(--color-accent, #4f46e5)',
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.6rem',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {currentName.slice(0, 2).toUpperCase()}
        </span>
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={currentName}
        >
          {currentName}
        </span>
      </div>
    );
  }

  // Multi-org — searchable dropdown
  const filtered = scope.organizations.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ position: 'relative' }} data-testid="tenant-switcher" data-multi-org="true">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Organization: ${currentName}. Click to switch.`}
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          padding: '0.5rem 0.75rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          background: 'var(--color-surface-alt, #f3f4f6)',
          border: 'none',
          borderRadius: '0.375rem',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={currentName}
        >
          {currentName}
        </span>
        <span aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Switch organization"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 50,
            background: 'var(--color-surface, #fff)',
            border: '1px solid var(--color-border, #e5e7eb)',
            borderRadius: '0.375rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            overflow: 'hidden',
          }}
        >
          <input
            type="search"
            placeholder="Search organizations…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
            aria-label="Search organizations"
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              border: 'none',
              borderBottom: '1px solid var(--color-border, #e5e7eb)',
              boxSizing: 'border-box',
              fontSize: '0.875rem',
              outline: 'none',
            }}
          />
          <ul
            role="listbox"
            aria-label="Organizations"
            style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '200px', overflowY: 'auto' }}
          >
            {filtered.length === 0 ? (
              <li style={{ padding: '0.5rem 0.75rem', color: 'var(--color-muted, #6b7280)', fontSize: '0.875rem' }}>
                No results
              </li>
            ) : (
              filtered.map(org => (
                <li key={org.id}>
                  <button
                    role="option"
                    aria-selected={org.id === scope.currentOrgId}
                    onClick={() => { setOpen(false); setSearch(''); }}
                    style={{
                      width: '100%',
                      padding: '0.5rem 0.75rem',
                      textAlign: 'left',
                      background: org.id === scope.currentOrgId
                        ? 'var(--color-nav-active-bg, #eef2ff)'
                        : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                  >
                    {org.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
