'use client';

/**
 * PendingSignupsPage — admin queue for pending portal signup requests (WO-091, AC10).
 *
 * Features:
 *   - Filterable table: status, submitted-date range, email domain search
 *   - Per-row detail drawer (SignupDetailDrawer) with approve / reject actions
 *   - Duplicate-domain conflict warning inline in the row
 *   - Optimistic list removal on approve / reject with rollback on failure
 *   - TanStack Query infinite cursor pagination
 *
 * Follows the OrgTable / OrgDetailDrawer patterns from the organizations feature.
 */

import React, { useState, useCallback, useDeferredValue } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { SignupDetailDrawer } from './SignupDetailDrawer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingSignupItem {
  id: string;
  maskedEmail: string;
  domain: string;
  fullName: string | null;
  status: string;
  createdAt: string;
  verificationEmailStatus: string | null;
  duplicateDomainConflict: boolean;
  suggestedOrganizations: Array<{ id: string; name: string; score: number }>;
}

export interface PendingSignupsPage {
  data: PendingSignupItem[];
  nextCursor: string | null;
}

export interface ApproveResult {
  userId: string;
  organizationId: string;
  activationPath: 'verification_email' | 'active';
  verifiedDomainAdded: boolean;
}

export type RejectReason =
  | 'not_a_customer'
  | 'unrecognised_domain'
  | 'duplicate_request'
  | 'security_concern'
  | 'other';

export interface SignupFilters {
  status?: string;
  domain?: string;
  from?: string;
  to?: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(
      body?.error?.message ?? `Request failed: ${res.status}`,
    ) as Error & { status: number; code?: string };
    err.status = res.status;
    err.code = body?.error?.code;
    throw err;
  }
  return res.json();
}

function buildListUrl(filters: SignupFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.status)  params.set('status', filters.status);
  if (filters.domain)  params.set('domain', filters.domain);
  if (filters.from)    params.set('from', filters.from);
  if (filters.to)      params.set('to', filters.to);
  if (cursor)          params.set('cursor', cursor);
  params.set('limit', '25');
  return `/api/v1/admin/portal-signups?${params}`;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const SIGNUP_KEYS = {
  list: (filters: SignupFilters) => ['admin', 'portal-signups', filters] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function usePendingSignups(filters: SignupFilters) {
  return useInfiniteQuery<PendingSignupsPage>({
    queryKey: SIGNUP_KEYS.list(filters),
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as string | undefined;
      return apiFetch<PendingSignupsPage>(buildListUrl(filters, cursor));
    },
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

export function useApproveSignup(filters: SignupFilters) {
  const qc = useQueryClient();
  return useMutation<ApproveResult, Error & { status?: number; code?: string }, {
    id: string;
    organizationId: string;
    addVerifiedDomain?: boolean;
  }>({
    mutationFn: ({ id, organizationId, addVerifiedDomain }) =>
      apiFetch<ApproveResult>(`/api/v1/admin/portal-signups/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ organizationId, addVerifiedDomain }),
      }),
    onMutate: async ({ id }) => {
      const key = SIGNUP_KEYS.list(filters);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<InfiniteData<PendingSignupsPage>>(key);
      // Optimistic removal
      qc.setQueryData<InfiniteData<PendingSignupsPage>>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            data: page.data.filter((s) => s.id !== id),
          })),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      // Rollback on failure
      if (ctx?.previous) {
        qc.setQueryData(SIGNUP_KEYS.list(filters), ctx.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: SIGNUP_KEYS.list(filters) });
    },
  });
}

export function useRejectSignup(filters: SignupFilters) {
  const qc = useQueryClient();
  return useMutation<{ status: string }, Error & { status?: number; code?: string }, {
    id: string;
    reason: RejectReason;
    note?: string;
    notifyApplicant?: boolean;
  }>({
    mutationFn: ({ id, reason, note, notifyApplicant }) =>
      apiFetch<{ status: string }>(`/api/v1/admin/portal-signups/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason, note, notifyApplicant }),
      }),
    onMutate: async ({ id }) => {
      const key = SIGNUP_KEYS.list(filters);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<InfiniteData<PendingSignupsPage>>(key);
      // Optimistic removal
      qc.setQueryData<InfiniteData<PendingSignupsPage>>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            data: page.data.filter((s) => s.id !== id),
          })),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(SIGNUP_KEYS.list(filters), ctx.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: SIGNUP_KEYS.list(filters) });
    },
  });
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    pending_admin_approval: { bg: '#fef3c7', color: '#92400e' },
    approved:               { bg: '#d1fae5', color: '#065f46' },
    rejected:               { bg: '#fee2e2', color: '#991b1b' },
    expired:                { bg: '#f3f4f6', color: '#6b7280' },
  };
  const style = map[status] ?? { bg: '#f3f4f6', color: '#374151' };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        background: style.bg,
        color: style.color,
        whiteSpace: 'nowrap',
      }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Verification-email status badge
// ---------------------------------------------------------------------------

function VerificationBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>;
  const map: Record<string, { color: string; label: string }> = {
    delivered: { color: '#059669', label: 'Delivered' },
    bounced:   { color: '#dc2626', label: '⚠ Bounced' },
    pending:   { color: '#d97706', label: 'Pending' },
    failed:    { color: '#dc2626', label: 'Failed' },
  };
  const s = map[status] ?? { color: '#6b7280', label: status };
  return (
    <span style={{ fontSize: 12, color: s.color, fontWeight: status === 'bounced' ? 600 : 400 }}>
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  filters: SignupFilters;
  onChange: (f: SignupFilters) => void;
}

function FilterBar({ filters, onChange }: FilterBarProps) {
  return (
    <div
      data-testid="signup-filter-bar"
      style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}
    >
      <select
        aria-label="Filter by status"
        value={filters.status ?? ''}
        onChange={(e) => onChange({ ...filters, status: e.target.value || undefined })}
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          fontSize: 13,
          background: '#fff',
        }}
      >
        <option value="">All statuses</option>
        <option value="pending_admin_approval">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
        <option value="expired">Expired</option>
      </select>

      <input
        type="text"
        aria-label="Search by email domain"
        placeholder="Search domain…"
        value={filters.domain ?? ''}
        onChange={(e) => onChange({ ...filters, domain: e.target.value || undefined })}
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          fontSize: 13,
          minWidth: 180,
        }}
      />

      <input
        type="date"
        aria-label="From date"
        value={filters.from ?? ''}
        onChange={(e) => onChange({ ...filters, from: e.target.value || undefined })}
        style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
      />

      <input
        type="date"
        aria-label="To date"
        value={filters.to ?? ''}
        onChange={(e) => onChange({ ...filters, to: e.target.value || undefined })}
        style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function PendingSignupsPage() {
  const [filters, setFilters] = useState<SignupFilters>({ status: 'pending_admin_approval' });
  const deferredFilters = useDeferredValue(filters);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = usePendingSignups(deferredFilters);

  const approveMutation = useApproveSignup(deferredFilters);
  const rejectMutation  = useRejectSignup(deferredFilters);

  const items: PendingSignupItem[] = data?.pages.flatMap((p) => p.data) ?? [];

  const selectedItem = items.find((s) => s.id === selectedId) ?? null;

  const handleRowClick = useCallback((id: string) => setSelectedId(id), []);
  const handleDrawerClose = useCallback(() => setSelectedId(null), []);

  const handleApprove = useCallback(
    (id: string, organizationId: string, addVerifiedDomain?: boolean) =>
      approveMutation.mutateAsync({ id, organizationId, addVerifiedDomain }).then(() => {
        setSelectedId(null);
      }),
    [approveMutation],
  );

  const handleReject = useCallback(
    (id: string, reason: RejectReason, note?: string, notifyApplicant?: boolean) =>
      rejectMutation.mutateAsync({ id, reason, note, notifyApplicant }).then(() => {
        setSelectedId(null);
      }),
    [rejectMutation],
  );

  return (
    <div data-testid="pending-signups-page">
      <header style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            margin: 0,
            color: 'var(--color-fg-primary, #111827)',
          }}
        >
          Portal Signup Queue
        </h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
          Approve or reject pending applicants. All decisions are audited.
        </p>
      </header>

      <FilterBar filters={filters} onChange={setFilters} />

      {isError && (
        <div
          role="alert"
          data-testid="signup-error-banner"
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 13,
            color: '#991b1b',
          }}
        >
          Failed to load signup queue: {(error as Error)?.message ?? 'Unknown error'}
        </div>
      )}

      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <table
          role="grid"
          aria-label="Pending portal signup requests"
          data-testid="signup-table"
          style={{ width: '100%', borderCollapse: 'collapse' }}
        >
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              {['Email (masked)', 'Domain', 'Name', 'Status', 'Submitted', 'Verification', 'Conflict'].map(
                (col) => (
                  <th
                    key={col}
                    style={{
                      padding: '10px 14px',
                      textAlign: 'left',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#374151',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {col}
                  </th>
                ),
              )}
              <th style={{ padding: '10px 14px', width: 1 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                  Loading…
                </td>
              </tr>
            )}

            {!isLoading && items.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  data-testid="signup-empty-state"
                  style={{ padding: 32, textAlign: 'center', color: '#6b7280', fontSize: 14 }}
                >
                  No signup requests match the selected filters.
                </td>
              </tr>
            )}

            {items.map((item) => (
              <SignupRow
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                onClick={handleRowClick}
              />
            ))}
          </tbody>
        </table>

        {hasNextPage && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              style={{
                padding: '6px 20px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                fontSize: 13,
                cursor: isFetchingNextPage ? 'wait' : 'pointer',
                color: '#374151',
              }}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      {selectedItem && (
        <SignupDetailDrawer
          item={selectedItem}
          onClose={handleDrawerClose}
          onApprove={handleApprove}
          onReject={handleReject}
          isApproving={approveMutation.isPending}
          isRejecting={rejectMutation.isPending}
          approveError={approveMutation.error ?? null}
          rejectError={rejectMutation.error ?? null}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SignupRow
// ---------------------------------------------------------------------------

interface SignupRowProps {
  item: PendingSignupItem;
  selected: boolean;
  onClick: (id: string) => void;
}

function SignupRow({ item, selected, onClick }: SignupRowProps) {
  const formattedDate = new Date(item.createdAt).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <tr
      data-testid="signup-row"
      aria-selected={selected}
      onClick={() => onClick(item.id)}
      style={{
        borderBottom: '1px solid #f3f4f6',
        cursor: 'pointer',
        background: selected ? '#eff6ff' : undefined,
        transition: 'background 0.1s',
      }}
    >
      <td style={{ padding: '10px 14px', fontSize: 13, color: '#374151', fontFamily: 'monospace' }}>
        {item.maskedEmail}
      </td>
      <td style={{ padding: '10px 14px', fontSize: 13, color: '#374151' }}>
        {item.domain}
      </td>
      <td style={{ padding: '10px 14px', fontSize: 13, color: '#374151' }}>
        {item.fullName ?? <span style={{ color: '#9ca3af' }}>—</span>}
      </td>
      <td style={{ padding: '10px 14px' }}>
        <StatusBadge status={item.status} />
      </td>
      <td style={{ padding: '10px 14px', fontSize: 13, color: '#6b7280', whiteSpace: 'nowrap' }}>
        {formattedDate}
      </td>
      <td style={{ padding: '10px 14px' }}>
        <VerificationBadge status={item.verificationEmailStatus} />
      </td>
      <td style={{ padding: '10px 14px' }}>
        {item.duplicateDomainConflict && (
          <span
            data-testid="conflict-warning"
            title="Another organization already claims this domain"
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#b45309',
              background: '#fef3c7',
              border: '1px solid #fde68a',
              padding: '2px 6px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
            }}
          >
            ⚠ Domain conflict
          </span>
        )}
      </td>
      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
        <button
          type="button"
          aria-label={`Open details for ${item.maskedEmail}`}
          onClick={(e) => { e.stopPropagation(); onClick(item.id); }}
          style={{
            padding: '4px 10px',
            fontSize: 12,
            borderRadius: 5,
            border: '1px solid #d1d5db',
            background: '#fff',
            cursor: 'pointer',
            color: '#374151',
          }}
        >
          Review
        </button>
      </td>
    </tr>
  );
}
