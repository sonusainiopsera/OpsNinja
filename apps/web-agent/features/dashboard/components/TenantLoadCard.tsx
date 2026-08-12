'use client';

/**
 * TenantLoadCard — per-organisation open ticket counts (WO-070, AC1).
 *
 * Renders org-load rows in a sortable, accessible table. Rows for
 * organisations outside the principal's scope never appear because the
 * server only returns in-scope rows.
 *
 * Zero-state: explicit "No organisations" copy, not a spinner.
 */

import React, { useMemo, useState } from 'react';
import type { OrgLoadRow } from '../../../lib/api/dashboard';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface TenantLoadCardProps {
  rows: OrgLoadRow[];
  loading?: boolean;
  className?: string;
}

type SortKey = 'organizationName' | 'openCount';
type SortDir = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TenantLoadCard({ rows, loading = false, className }: TenantLoadCardProps) {
  const [sortKey, setSortKey] = useState<SortKey>('openCount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = sortKey === 'openCount' ? a.openCount : a.organizationName;
      const bv = sortKey === 'openCount' ? b.openCount : b.organizationName;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'openCount' ? 'desc' : 'asc');
    }
  }

  if (loading) {
    return (
      <section
        className={className}
        aria-label="Organisation load"
        aria-busy="true"
        data-testid="tenant-load-card"
      >
        <p
          style={{
            fontSize: 13,
            color: 'var(--color-fg-tertiary, #9ca3af)',
            padding: '20px 0',
            textAlign: 'center',
          }}
        >
          Loading…
        </p>
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section
        className={className}
        aria-label="Organisation load: no organisations"
        data-testid="tenant-load-card"
        data-empty="true"
      >
        <p
          style={{
            fontSize: 13,
            color: 'var(--color-fg-tertiary, #9ca3af)',
            padding: '20px 0',
            textAlign: 'center',
          }}
        >
          No organisations
        </p>
      </section>
    );
  }

  function sortLabel(key: SortKey): string {
    if (sortKey !== key) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  return (
    <section
      className={className}
      aria-label="Organisation load"
      data-testid="tenant-load-card"
    >
      <table
        style={{ width: '100%', borderCollapse: 'collapse' }}
        aria-label="Organisation open ticket counts"
      >
        <thead>
          <tr style={{ borderBottom: '2px solid var(--color-border, #e5e7eb)' }}>
            <th
              scope="col"
              aria-sort={sortLabel('organizationName')}
              style={{
                padding: '6px 8px',
                fontSize: 11,
                fontWeight: 600,
                textAlign: 'left',
                color: 'var(--color-fg-secondary, #6b7280)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onClick={() => handleSort('organizationName')}
            >
              Organisation
              {sortKey === 'organizationName' && (
                <span aria-hidden="true">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>
              )}
            </th>
            <th
              scope="col"
              aria-sort={sortLabel('openCount')}
              style={{
                padding: '6px 8px',
                fontSize: 11,
                fontWeight: 600,
                textAlign: 'right',
                color: 'var(--color-fg-secondary, #6b7280)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onClick={() => handleSort('openCount')}
            >
              Open
              {sortKey === 'openCount' && (
                <span aria-hidden="true">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.organizationId}
              data-testid="org-load-row"
              style={{ borderBottom: '1px solid var(--color-border, #e5e7eb)' }}
            >
              <td
                style={{
                  padding: '8px',
                  fontSize: 13,
                  color: 'var(--color-fg-primary, #111827)',
                  maxWidth: 200,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={row.organizationName}
              >
                {row.organizationName}
              </td>
              <td
                style={{
                  padding: '8px',
                  fontSize: 13,
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  textAlign: 'right',
                  color:
                    row.openCount > 10
                      ? 'var(--color-danger, #dc2626)'
                      : 'var(--color-fg-primary, #111827)',
                }}
              >
                {row.openCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
