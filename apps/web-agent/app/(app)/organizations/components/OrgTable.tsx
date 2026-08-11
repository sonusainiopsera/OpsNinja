'use client';

/**
 * OrgTable — cursor-paginated organizations table with keyboard navigation.
 *
 * Features:
 *   - Infinite scroll / load-more via useOrganizations (cursor pagination)
 *   - Each row: OrgAvatar, name, tier badge, region, open ticket count,
 *     SLA attainment, StatusBadge, RowMenu (view/edit/deactivate/reactivate)
 *   - Keyboard: ↑/↓ navigate rows; Enter opens drawer
 *   - Empty state with create call-to-action
 *   - Permission-gated write actions (admin / manager only)
 *   - Stale-request protection: React Query cancels superseded fetches
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { Organization, OrgListFilters } from '../../../../lib/api/organizations/types';
import { useOrganizations } from '../../../../lib/api/organizations/hooks';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OrgAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return avatarUrl ? (
    <img
      src={avatarUrl}
      alt={`${name} avatar`}
      style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
    />
  ) : (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'var(--color-primary-soft, #e0e7ff)',
        color: 'var(--color-primary, #4f46e5)',
        fontWeight: 700,
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      {initials || '?'}
    </span>
  );
}

const TIER_COLORS: Record<string, string> = {
  free:       '#6b7280',
  starter:    '#0284c7',
  growth:     '#7c3aed',
  enterprise: '#d97706',
};

function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 99,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        background: `${TIER_COLORS[tier] ?? '#6b7280'}22`,
        color: TIER_COLORS[tier] ?? '#6b7280',
        border: `1px solid ${TIER_COLORS[tier] ?? '#6b7280'}44`,
      }}
    >
      {tier}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const MAP: Record<string, { bg: string; color: string }> = {
    active:   { bg: '#d1fae5', color: '#065f46' },
    inactive: { bg: '#f3f4f6', color: '#6b7280' },
    suspended:{ bg: '#fee2e2', color: '#991b1b' },
  };
  const s = MAP[status] ?? { bg: '#f3f4f6', color: '#6b7280' };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 500,
        background: s.bg,
        color: s.color,
      }}
    >
      {status}
    </span>
  );
}

interface RowMenuProps {
  org: Organization;
  canWrite: boolean;
  onView: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}

function RowMenu({ org, canWrite, onView, onEdit, onDeactivate, onReactivate }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!btnRef.current?.parentElement?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        aria-label={`Actions for ${org.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{
          padding: '4px 8px',
          background: 'none',
          border: '1px solid var(--color-border, #e5e7eb)',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          color: 'var(--color-muted, #6b7280)',
        }}
      >
        ⋯
      </button>

      {open && (
        <ul
          role="menu"
          aria-label={`Actions for ${org.name}`}
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            minWidth: 160,
            background: 'var(--color-bg-card, #fff)',
            border: '1px solid var(--color-border, #e5e7eb)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 100,
            padding: '4px 0',
            listStyle: 'none',
            margin: 0,
          }}
        >
          {[
            { label: 'View details', action: onView, visible: true },
            { label: 'Edit profile', action: onEdit, visible: canWrite },
            {
              label: 'Deactivate',
              action: onDeactivate,
              visible: canWrite && org.status === 'active',
              danger: true,
            },
            {
              label: 'Reactivate',
              action: onReactivate,
              visible: canWrite && org.status !== 'active',
            },
          ]
            .filter((item) => item.visible)
            .map((item) => (
              <li key={item.label} role="none">
                <button
                  role="menuitem"
                  onClick={(e) => { e.stopPropagation(); setOpen(false); item.action(); }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 16px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: item.danger ? '#dc2626' : 'var(--color-fg-primary, #111827)',
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrgTable
// ---------------------------------------------------------------------------

interface OrgTableProps {
  filters: Omit<OrgListFilters, 'cursor'>;
  canWrite: boolean;
  selectedOrgId: string | null;
  onSelectOrg: (org: Organization) => void;
  onNewOrg: () => void;
  onDeactivate: (org: Organization) => void;
  onReactivate: (orgId: string) => void;
}

export function OrgTable({
  filters,
  canWrite,
  selectedOrgId,
  onSelectOrg,
  onNewOrg,
  onDeactivate,
  onReactivate,
}: OrgTableProps) {
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useOrganizations(filters);

  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  // Keyboard navigation
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableRowElement>, idx: number) => {
      if (!tbodyRef.current) return;
      const allRows = Array.from(
        tbodyRef.current.querySelectorAll<HTMLTableRowElement>('tr[data-row-idx]'),
      );
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        (allRows[idx + 1] as HTMLElement | undefined)?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        (allRows[idx - 1] as HTMLElement | undefined)?.focus();
      } else if (e.key === 'Enter') {
        const org = rows[idx];
        if (org) onSelectOrg(org);
      }
    },
    [rows, onSelectOrg],
  );

  if (isError) {
    return (
      <div role="alert" style={{ padding: 24, color: '#dc2626', fontSize: 14 }}>
        Failed to load organizations: {(error as Error).message}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div aria-label="Loading organizations" style={{ padding: 24 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 48,
              background: 'var(--color-bg-alt, #f3f4f6)',
              borderRadius: 4,
              marginBottom: 8,
              animation: 'pulse 1.5s infinite',
            }}
          />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: 48,
          textAlign: 'center',
          border: '1px dashed var(--color-border, #e5e7eb)',
          borderRadius: 8,
          background: 'var(--color-bg-card, #fff)',
          margin: 16,
        }}
      >
        <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', marginBottom: 8 }}>
          No organizations found
        </p>
        <p style={{ fontSize: 14, color: 'var(--color-muted, #6b7280)', marginBottom: 16 }}>
          {Object.values(filters).some(Boolean)
            ? 'Try adjusting your filters or clearing the search.'
            : 'Get started by creating your first organization.'}
        </p>
        {canWrite && !Object.values(filters).some(Boolean) && (
          <button
            type="button"
            onClick={onNewOrg}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--color-primary, #4f46e5)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Create organization
          </button>
        )}
      </div>
    );
  }

  const COL: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: 13,
    color: 'var(--color-fg-primary, #111827)',
    textAlign: 'left',
    borderBottom: '1px solid var(--color-border, #e5e7eb)',
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}
        aria-label="Organizations list"
      >
        <thead>
          <tr style={{ background: 'var(--color-bg-alt, #f9fafb)' }}>
            {['Organization', 'Tier', 'Region', 'Open Tickets', 'SLA %', 'Status', ''].map((h) => (
              <th
                key={h}
                scope="col"
                style={{
                  ...COL,
                  fontWeight: 600,
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--color-muted, #6b7280)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {rows.map((org, idx) => (
            <tr
              key={org.id}
              data-row-idx={idx}
              tabIndex={0}
              aria-selected={org.id === selectedOrgId}
              onClick={() => onSelectOrg(org)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              style={{
                background:
                  org.id === selectedOrgId
                    ? 'var(--color-primary-soft, #eef2ff)'
                    : 'var(--color-bg-card, #fff)',
                cursor: 'pointer',
                outline: 'none',
              }}
              onFocus={(e) => (e.currentTarget.style.boxShadow = 'inset 0 0 0 2px var(--color-primary, #4f46e5)')}
              onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
            >
              <td style={COL}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <OrgAvatar name={org.name} avatarUrl={org.avatarUrl} />
                  <span style={{ fontWeight: 500 }}>{org.name}</span>
                </div>
              </td>
              <td style={COL}><TierBadge tier={org.tier} /></td>
              <td style={{ ...COL, color: 'var(--color-muted, #6b7280)' }}>
                {org.region ?? '—'}
              </td>
              <td style={{ ...COL, textAlign: 'right' as const }}>{org.openTicketCount}</td>
              <td style={{ ...COL, textAlign: 'right' as const }}>
                {org.slaAttainmentPct !== null ? `${org.slaAttainmentPct}%` : '—'}
              </td>
              <td style={COL}><StatusBadge status={org.status} /></td>
              <td style={{ ...COL, width: 56 }}>
                <RowMenu
                  org={org}
                  canWrite={canWrite}
                  onView={() => onSelectOrg(org)}
                  onEdit={() => onSelectOrg(org)}
                  onDeactivate={() => onDeactivate(org)}
                  onReactivate={() => onReactivate(org.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {hasNextPage && (
        <div style={{ textAlign: 'center', padding: 16 }}>
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            style={{
              padding: '8px 24px',
              borderRadius: 6,
              border: '1px solid var(--color-border, #e5e7eb)',
              background: 'var(--color-bg-card, #fff)',
              cursor: isFetchingNextPage ? 'wait' : 'pointer',
              fontSize: 13,
              color: 'var(--color-fg-secondary, #374151)',
            }}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
