/**
 * TicketListPage — portal ticket list with status + SLA badges — WO-090 AC1, AC2, AC9.
 *
 * Features:
 *   - Allow-listed status and free-text subject search filters (AC2)
 *   - Keyset cursor pagination (AC1)
 *   - StatusBadge and SlaHint badges for each ticket
 *   - Empty, loading, and error states
 *   - No agent-only components imported (AC9 / ESLint boundary rule)
 *
 * Security: filters are applied as parameterised predicates server-side —
 * this component only passes strings that the server allow-lists.
 */

'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { StatusBadge, SlaHint } from '@opsninja/ui-kit/portal';
import { usePortalTicketList } from '../../lib/api/tickets/hooks';
import type { PortalTicketListFilters } from '../../lib/api/tickets/types';

// ---------------------------------------------------------------------------
// Status filter options — mirrors the server allow-list in portal-filter-mapper
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'pending_customer', label: 'Pending Customer' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TicketListPage() {
  // Filters that have been submitted (trigger actual API calls)
  const [filters, setFilters] = useState<PortalTicketListFilters>({});
  // Cursor stack for forward/back navigation
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  // Draft filter state (controlled inputs before submit)
  const [draftStatus, setDraftStatus] = useState('');
  const [draftQuery, setDraftQuery] = useState('');

  const { data, isLoading, isError, error } = usePortalTicketList(
    cursor ? { ...filters, cursor } : filters,
  );

  // Apply filters — reset to first page
  const handleSearch = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setCursor(undefined);
      setCursorStack([]);
      setFilters({
        ...(draftStatus ? { status: draftStatus } : {}),
        ...(draftQuery.trim() ? { q: draftQuery.trim() } : {}),
      });
    },
    [draftStatus, draftQuery],
  );

  const handleNextPage = useCallback(() => {
    if (!data?.nextCursor) return;
    setCursorStack((prev) => (cursor ? [...prev, cursor] : prev));
    setCursor(data.nextCursor);
  }, [data?.nextCursor, cursor]);

  const handlePrevPage = useCallback(() => {
    const prev = cursorStack[cursorStack.length - 1];
    setCursorStack((s) => s.slice(0, -1));
    setCursor(prev);
  }, [cursorStack]);

  const tickets = data?.data ?? [];
  const isEmpty = !isLoading && !isError && tickets.length === 0;

  return (
    <section aria-labelledby="tickets-heading" style={{ padding: 24, maxWidth: 900 }}>
      <h1
        id="tickets-heading"
        style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 600 }}
      >
        My Tickets
      </h1>

      {/* ── Filters ── */}
      <form
        onSubmit={handleSearch}
        style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}
        aria-label="Filter tickets"
      >
        <div>
          <label
            htmlFor="ticket-status-filter"
            style={{ display: 'block', fontSize: 13, marginBottom: 4, fontWeight: 500 }}
          >
            Status
          </label>
          <select
            id="ticket-status-filter"
            value={draftStatus}
            onChange={(e) => setDraftStatus(e.target.value)}
            data-testid="status-filter"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid var(--portal-border, #d1d5db)',
              fontSize: 14,
              background: 'var(--portal-surface, #fff)',
            }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <label
            htmlFor="ticket-search"
            style={{ display: 'block', fontSize: 13, marginBottom: 4, fontWeight: 500 }}
          >
            Search
          </label>
          <input
            id="ticket-search"
            type="search"
            value={draftQuery}
            onChange={(e) => setDraftQuery(e.target.value)}
            placeholder="Search by subject…"
            maxLength={200}
            data-testid="subject-search"
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid var(--portal-border, #d1d5db)',
              fontSize: 14,
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--portal-surface, #fff)',
            }}
          />
        </div>

        <button
          type="submit"
          data-testid="apply-filters"
          style={{
            padding: '6px 16px',
            borderRadius: 6,
            background: 'var(--portal-primary, #2563eb)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: 14,
          }}
        >
          Search
        </button>
      </form>

      {/* ── Loading ── */}
      {isLoading && (
        <p
          role="status"
          data-testid="tickets-loading"
          style={{ color: 'var(--portal-fg-muted, #6b7280)' }}
        >
          Loading tickets…
        </p>
      )}

      {/* ── Error ── */}
      {isError && (
        <p
          role="alert"
          data-testid="tickets-error"
          style={{ color: 'var(--portal-danger, #dc2626)' }}
        >
          {(error as Error)?.message ?? 'Failed to load tickets. Please try again.'}
        </p>
      )}

      {/* ── Empty ── */}
      {isEmpty && (
        <p
          data-testid="tickets-empty"
          style={{ color: 'var(--portal-fg-muted, #6b7280)' }}
        >
          No tickets found. If you need help, please{' '}
          <Link href="/submit" style={{ color: 'var(--portal-primary, #2563eb)' }}>
            submit a new request
          </Link>
          .
        </p>
      )}

      {/* ── Ticket list ── */}
      {!isLoading && !isError && tickets.length > 0 && (
        <ul
          aria-label="Your tickets"
          style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <Link
                href={`/tickets/${ticket.id}`}
                data-testid={`ticket-row-${ticket.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--portal-border, #e5e7eb)',
                  textDecoration: 'none',
                  color: 'inherit',
                  background: 'var(--portal-surface, #fff)',
                }}
              >
                {/* Subject + reference */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      marginBottom: ticket.reference ? 2 : 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {ticket.subject}
                  </div>
                  {ticket.reference && (
                    <div style={{ fontSize: 12, color: 'var(--portal-fg-muted, #6b7280)' }}>
                      #{ticket.reference}
                    </div>
                  )}
                </div>

                {/* Status badge */}
                <StatusBadge
                  status={ticket.status as Parameters<typeof StatusBadge>[0]['status']}
                />

                {/* SLA hint — coarse state only */}
                {ticket.sla && (
                  <SlaHint state={ticket.sla.state} />
                )}

                {/* Date */}
                <time
                  dateTime={ticket.createdAt}
                  style={{ fontSize: 12, color: 'var(--portal-fg-muted, #6b7280)', whiteSpace: 'nowrap' }}
                >
                  {new Date(ticket.createdAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* ── Pagination ── */}
      {!isLoading && !isError && (cursorStack.length > 0 || data?.nextCursor) && (
        <nav
          aria-label="Ticket list pagination"
          style={{ display: 'flex', gap: 8, marginTop: 16 }}
        >
          <button
            onClick={handlePrevPage}
            disabled={cursorStack.length === 0}
            data-testid="prev-page"
            aria-label="Previous page"
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid var(--portal-border, #d1d5db)',
              background: 'var(--portal-surface, #fff)',
              cursor: cursorStack.length === 0 ? 'not-allowed' : 'pointer',
              opacity: cursorStack.length === 0 ? 0.5 : 1,
              fontSize: 14,
            }}
          >
            ← Previous
          </button>
          <button
            onClick={handleNextPage}
            disabled={!data?.nextCursor}
            data-testid="next-page"
            aria-label="Next page"
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid var(--portal-border, #d1d5db)',
              background: 'var(--portal-surface, #fff)',
              cursor: !data?.nextCursor ? 'not-allowed' : 'pointer',
              opacity: !data?.nextCursor ? 0.5 : 1,
              fontSize: 14,
            }}
          >
            Next →
          </button>
        </nav>
      )}
    </section>
  );
}
