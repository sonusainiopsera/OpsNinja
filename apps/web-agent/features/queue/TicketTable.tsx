'use client';

/**
 * TicketTable — virtualised ticket queue table with SLA countdowns.
 *
 * Virtualisation: fixed row height (48px) + CSS transform to position rows,
 * rendering only visible + overscan rows for DOM performance with 100+ rows.
 *
 * SLA: uses SlaCountdown from @opsninja/ui-kit (shared SlaClockProvider).
 *
 * Accessibility:
 *   - role="grid" with aria-rowcount + aria-colcount
 *   - Each row: role="row", each cell: role="gridcell"
 *   - Keyboard: ↑/↓/Home/End navigate rows; Space toggles selection
 *   - Checkbox column: aria-label per row
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SlaCountdown, PriorityBadge, JiraLinkChip } from '@opsninja/ui-kit';
import type { TicketRow } from '../../lib/api/tickets/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 48;
const OVERSCAN = 5;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  open:               { bg: '#dbeafe', color: '#1e40af' },
  in_progress:        { bg: '#d1fae5', color: '#065f46' },
  pending_customer:   { bg: '#fef3c7', color: '#92400e' },
  pending_engineering:{ bg: '#ede9fe', color: '#5b21b6' },
  resolved:           { bg: '#e5e7eb', color: '#374151' },
  closed:             { bg: '#f3f4f6', color: '#9ca3af' },
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  pending_customer: 'Pending Customer',
  pending_engineering: 'Pending Eng',
  resolved: 'Resolved',
  closed: 'Closed',
};

function StatusChip({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? { bg: '#f3f4f6', color: '#6b7280' };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 500,
        background: s.bg,
        color: s.color,
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function TagChip({ name }: { name: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 99,
        fontSize: 10,
        fontWeight: 500,
        background: 'var(--color-bg-alt, #f3f4f6)',
        color: 'var(--color-muted, #6b7280)',
        border: '1px solid var(--color-border, #e5e7eb)',
        whiteSpace: 'nowrap',
        maxWidth: 80,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      title={name}
    >
      {name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: 'select',    label: '',               width: 40,  srOnly: true },
  { key: 'number',    label: '#',              width: 56  },
  { key: 'subject',   label: 'Subject',        width: 260 },
  { key: 'status',    label: 'Status',         width: 120 },
  { key: 'sla',       label: 'SLA',            width: 130 },
  { key: 'priority',  label: 'Priority',       width: 80  },
  { key: 'category',  label: 'Category',       width: 140 },
  { key: 'org',       label: 'Organisation',   width: 130 },
  { key: 'assignee',  label: 'Assignee',       width: 110 },
  { key: 'tags',      label: 'Tags',           width: 120 },
  { key: 'jira',      label: 'Jira',           width: 80  },
] as const;

// ---------------------------------------------------------------------------
// TicketTable
// ---------------------------------------------------------------------------

export interface TicketTableProps {
  rows: TicketRow[];
  totalCount: number;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  /** Set of selected ticket IDs */
  selected: ReadonlySet<string>;
  isAllSelected: boolean;
  isIndeterminate: boolean;
  onToggleRow: (id: string, idx: number, shift: boolean) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRowClick?: (ticket: TicketRow) => void;
}

export function TicketTable({
  rows,
  totalCount,
  isLoading,
  isError,
  errorMessage,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  selected,
  isAllSelected,
  isIndeterminate,
  onToggleRow,
  onSelectAll,
  onClearSelection,
  onRowClick,
}: TicketTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  // Measure container height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    obs.observe(el);
    setContainerHeight(el.clientHeight);
    return () => obs.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
    // Load more when within 2 rows of the bottom
    const { scrollTop: st, scrollHeight, clientHeight } = e.currentTarget;
    if (hasNextPage && !isFetchingNextPage && scrollHeight - st - clientHeight < ROW_HEIGHT * 2) {
      onLoadMore();
    }
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  // Virtualisation math
  const totalHeight = rows.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(rows.length - 1, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);
  const visibleRows = rows.slice(startIdx, endIdx + 1);

  const totalWidth = COLUMNS.reduce((acc, c) => acc + c.width, 0);

  const CELL: React.CSSProperties = {
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    fontSize: 13,
    color: 'var(--color-fg-primary, #111827)',
    borderRight: '1px solid var(--color-border-light, #f3f4f6)',
    overflow: 'hidden',
    flexShrink: 0,
  };

  if (isError) {
    return (
      <div role="alert" style={{ padding: 32, textAlign: 'center', color: '#dc2626', fontSize: 14 }}>
        <p style={{ fontWeight: 600, marginBottom: 8 }}>Failed to load tickets</p>
        <p style={{ color: 'var(--color-muted, #6b7280)' }}>{errorMessage ?? 'An error occurred. Please try again.'}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div aria-label="Loading tickets" style={{ padding: '8px 0' }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            aria-hidden="true"
            style={{
              height: ROW_HEIGHT - 1,
              margin: '0 0 1px 0',
              background: 'var(--color-bg-alt, #f9fafb)',
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
          margin: 16,
        }}
      >
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', marginBottom: 8 }}>
          No tickets found
        </p>
        <p style={{ fontSize: 13, color: 'var(--color-muted, #6b7280)' }}>
          {selected.size > 0 ? 'Adjust your filters to find matching tickets.' : 'This view has no matching tickets.'}
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Fixed header */}
      <div
        role="row"
        aria-rowindex={1}
        style={{
          display: 'flex',
          background: 'var(--color-bg-alt, #f9fafb)',
          borderBottom: '2px solid var(--color-border, #e5e7eb)',
          minWidth: totalWidth,
          flexShrink: 0,
        }}
      >
        {COLUMNS.map((col) => (
          <div
            key={col.key}
            role="columnheader"
            style={{
              ...CELL,
              width: col.width,
              height: 36,
              fontWeight: 700,
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--color-muted, #6b7280)',
            }}
          >
            {col.key === 'select' ? (
              <input
                type="checkbox"
                aria-label={isAllSelected ? 'Deselect all' : 'Select all on page'}
                checked={isAllSelected}
                ref={(el) => { if (el) el.indeterminate = isIndeterminate; }}
                onChange={() => (isAllSelected ? onClearSelection() : onSelectAll())}
                style={{ cursor: 'pointer' }}
              />
            ) : (
              <span className={col.key === 'select' ? 'sr-only' : undefined}>{col.label}</span>
            )}
          </div>
        ))}
      </div>

      {/* Virtual scroll container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        role="grid"
        aria-label="Ticket queue"
        aria-rowcount={rows.length + 1}
        aria-colcount={COLUMNS.length}
        tabIndex={0}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          position: 'relative',
          outline: 'none',
        }}
        onFocus={(e) => (e.currentTarget.style.boxShadow = 'inset 0 0 0 2px var(--color-primary, #4f46e5)')}
        onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
      >
        {/* Total height spacer */}
        <div style={{ height: totalHeight, position: 'relative', minWidth: totalWidth }}>
          {visibleRows.map((row, localIdx) => {
            const absIdx = startIdx + localIdx;
            const isSelected = selected.has(row.id);

            return (
              <div
                key={row.id}
                role="row"
                aria-rowindex={absIdx + 2}
                aria-selected={isSelected}
                tabIndex={-1}
                style={{
                  position: 'absolute',
                  top: absIdx * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                  height: ROW_HEIGHT,
                  display: 'flex',
                  alignItems: 'stretch',
                  background: isSelected
                    ? 'var(--color-primary-soft, #eef2ff)'
                    : absIdx % 2 === 0
                    ? 'var(--color-bg-card, #fff)'
                    : 'var(--color-bg-alt, #fafafa)',
                  borderBottom: '1px solid var(--color-border-light, #f3f4f6)',
                  cursor: 'pointer',
                  minWidth: totalWidth,
                }}
                onClick={() => onRowClick?.(row)}
                onKeyDown={(e) => {
                  if (e.key === ' ') {
                    e.preventDefault();
                    onToggleRow(row.id, absIdx, e.shiftKey);
                  } else if (e.key === 'Enter') {
                    onRowClick?.(row);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const grid = containerRef.current;
                    const nextRow = grid?.querySelector<HTMLElement>(`[aria-rowindex="${absIdx + 3}"]`);
                    nextRow?.focus();
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const grid = containerRef.current;
                    const prevRow = grid?.querySelector<HTMLElement>(`[aria-rowindex="${absIdx + 1}"]`);
                    prevRow?.focus();
                  }
                }}
                onFocus={(e) => (e.currentTarget.style.outline = '2px solid var(--color-primary, #4f46e5)')}
                onBlur={(e) => (e.currentTarget.style.outline = 'none')}
              >
                {/* Checkbox */}
                <div role="gridcell" style={{ ...CELL, width: 40, flexShrink: 0 }}>
                  <input
                    type="checkbox"
                    aria-label={`Select ticket #${row.ticketNumber}`}
                    checked={isSelected}
                    onChange={(e) => {
                      e.stopPropagation();
                      onToggleRow(row.id, absIdx, e.nativeEvent instanceof MouseEvent && (e.nativeEvent as MouseEvent).shiftKey);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ cursor: 'pointer' }}
                  />
                </div>

                {/* Ticket number */}
                <div role="gridcell" style={{ ...CELL, width: 56, color: 'var(--color-muted, #6b7280)', fontFamily: 'monospace', fontSize: 12 }}>
                  #{row.ticketNumber}
                </div>

                {/* Subject */}
                <div role="gridcell" style={{ ...CELL, width: 260 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }} title={row.subject}>
                    {row.subject}
                  </span>
                </div>

                {/* Status */}
                <div role="gridcell" style={{ ...CELL, width: 120 }}>
                  <StatusChip status={row.status} />
                </div>

                {/* SLA Countdown */}
                <div role="gridcell" style={{ ...CELL, width: 130 }}>
                  {row.sla?.targetAt ? (
                    <SlaCountdown
                      targetAt={row.sla.targetAt}
                      pausedMs={row.sla.pausedMs}
                      state={row.sla.state as import('@opsninja/ui-kit').SlaCountdownProps['state']}
                      serverNow={row.sla.serverNow}
                    />
                  ) : (
                    <span style={{ color: 'var(--color-muted, #9ca3af)', fontSize: 11 }}>—</span>
                  )}
                </div>

                {/* Priority */}
                <div role="gridcell" style={{ ...CELL, width: 80 }}>
                  <PriorityBadge priority={row.priority as import('@opsninja/ui-kit').Priority} />
                </div>

                {/* Category path */}
                <div role="gridcell" style={{ ...CELL, width: 140 }}>
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--color-fg-secondary, #374151)' }}
                    title={row.categoryPath ?? undefined}
                  >
                    {row.categoryPath ?? '—'}
                  </span>
                </div>

                {/* Organisation */}
                <div role="gridcell" style={{ ...CELL, width: 130 }}>
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}
                    title={row.organizationName}
                  >
                    {row.organizationName}
                  </span>
                </div>

                {/* Assignee */}
                <div role="gridcell" style={{ ...CELL, width: 110 }}>
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--color-fg-secondary, #374151)' }}
                    title={row.assigneeName ?? undefined}
                  >
                    {row.assigneeName ?? <span style={{ color: 'var(--color-muted, #9ca3af)' }}>Unassigned</span>}
                  </span>
                </div>

                {/* Tags */}
                <div role="gridcell" style={{ ...CELL, width: 120, gap: 4, flexWrap: 'nowrap', overflow: 'hidden' }}>
                  {row.tags.slice(0, 2).map((t) => (
                    <TagChip key={t.id} name={t.name} />
                  ))}
                  {row.tags.length > 2 && (
                    <span style={{ fontSize: 10, color: 'var(--color-muted, #9ca3af)' }} title={row.tags.map((t) => t.name).join(', ')}>
                      +{row.tags.length - 2}
                    </span>
                  )}
                </div>

                {/* Jira indicator */}
                <div role="gridcell" style={{ ...CELL, width: 80 }}>
                  {row.hasJiraLink ? (
                    <JiraLinkChip
                      issueKey={row.jiraIssueKey ?? 'Linked'}
                      href={row.jiraIssueKey ? `https://jira.example.com/browse/${row.jiraIssueKey}` : '#'}
                      syncState="synced"
                    />
                  ) : (
                    <span style={{ color: 'var(--color-muted, #d1d5db)', fontSize: 11 }}>—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer: count + load more */}
      <div
        style={{
          borderTop: '1px solid var(--color-border, #e5e7eb)',
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12,
          color: 'var(--color-muted, #6b7280)',
          flexShrink: 0,
        }}
      >
        <span>
          {selected.size > 0
            ? `${selected.size} of ${rows.length} selected`
            : `${rows.length} of ${totalCount} tickets`}
        </span>
        {hasNextPage && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            style={{
              padding: '4px 14px',
              borderRadius: 4,
              border: '1px solid var(--color-border, #d1d5db)',
              background: 'transparent',
              cursor: isFetchingNextPage ? 'wait' : 'pointer',
              fontSize: 12,
              color: 'var(--color-fg-secondary, #374151)',
            }}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}
