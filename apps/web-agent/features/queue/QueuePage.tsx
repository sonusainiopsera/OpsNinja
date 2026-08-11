'use client';

/**
 * QueuePage — Agent workspace ticket queue.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────┐
 *   │ ViewsRail (220px) │ Main content                 │
 *   │                   │ ┌─ QueueToolbar (FilterChips)┤
 *   │                   │ ├─ BulkActionBar (if sel > 0)┤
 *   │                   │ ├─ StaleDataBanner (if stale)┤
 *   │                   │ └─ TicketTable (virtualised) │
 *   └──────────────────────────────────────────────────┘
 *
 * SLA: SlaClockProvider wraps the table — single shared interval per page.
 * Cursor pagination: next_cursor forwarded by useTicketQueue infinite query.
 * Stale indicator: detects resultSetVersion mismatch across pages.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { SlaClockProvider } from '@opsninja/ui-kit';
import type { FilterAst } from '@opsninja/filter-compiler';
import { SYSTEM_VIEW_IDS } from '../../lib/api/views/types';
import { ViewsRail } from './ViewsRail';
import { FilterChipBar } from './FilterChipBar';
import { AddFilterDrawer } from './AddFilterDrawer';
import { TicketTable } from './TicketTable';
import { BulkActionBar } from './BulkActionBar';
import { SaveViewModal } from './SaveViewModal';
import { useBulkSelection } from './useBulkSelection';
import {
  useTicketQueue,
  flattenQueuePages,
  detectStaleResultSet,
  useBulkAction,
} from '../../lib/api/tickets/hooks';
import type { BulkActionType, BulkActionResponse, TicketPriority } from '../../lib/api/tickets/types';

// ---------------------------------------------------------------------------
// QueuePage
// ---------------------------------------------------------------------------

export function QueuePage() {
  const [activeViewId, setActiveViewId] = useState(SYSTEM_VIEW_IDS.ALL_OPEN);
  const [filter, setFilter] = useState<FilterAst | null>(null);
  const [sort, setSort] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [lastBulkResult, setLastBulkResult] = useState<BulkActionResponse | null>(null);

  // Data fetching
  const queueQuery = useTicketQueue({
    viewId: activeViewId,
    filter: filter ?? undefined,
    sort: sort ?? undefined,
    sortDir: sortDir ?? undefined,
  });

  const rows = flattenQueuePages(queueQuery.data);
  const isStale = detectStaleResultSet(queueQuery.data);
  const totalCount = queueQuery.data?.pages[0]?.total ?? 0;

  // Bulk selection
  const selection = useBulkSelection();

  // Keep pageIds in sync with loaded rows
  useEffect(() => {
    selection.setPage(rows.map((r) => r.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // Bulk action
  const bulkMutation = useBulkAction();

  const handleBulkAction = useCallback(
    (action: BulkActionType, opts: { assigneeUserId?: string | null; priority?: TicketPriority; tagId?: string }) => {
      setLastBulkResult(null);
      bulkMutation.mutate(
        {
          ticketIds: selection.selectedIds,
          action,
          ...opts,
        },
        {
          onSuccess: (result) => {
            setLastBulkResult(result);
            selection.clear();
          },
          onError: (err) => {
            setLastBulkResult({
              results: selection.selectedIds.map((id) => ({
                ticketId: id,
                success: false,
                error: { code: 'REQUEST_FAILED', message: err.message },
              })),
              succeeded: 0,
              failed: selection.selectedIds.length,
            });
          },
        },
      );
    },
    [bulkMutation, selection],
  );

  const handleRetryFailed = useCallback(
    (failedIds: string[]) => {
      if (!lastBulkResult) return;
      // Re-select failed IDs and clear result so user can resubmit
      selection.clear();
      failedIds.forEach((id) => {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx >= 0) selection.toggle(id, idx);
      });
      setLastBulkResult(null);
    },
    [lastBulkResult, rows, selection],
  );

  const handleViewChange = useCallback((viewId: string) => {
    setActiveViewId(viewId);
    setFilter(null);
    selection.clear();
    setLastBulkResult(null);
  }, [selection]);

  const handleFilterChange = useCallback((next: FilterAst | null) => {
    setFilter(next);
    selection.clear();
  }, [selection]);

  const errorMessage = queueQuery.isError
    ? ((queueQuery.error as Error & { traceId?: string })?.traceId
        ? `Error loading tickets (trace: ${(queueQuery.error as Error & { traceId?: string }).traceId})`
        : 'Failed to load tickets')
    : undefined;

  return (
    <SlaClockProvider>
      <div
        style={{
          display: 'flex',
          height: '100%',
          overflow: 'hidden',
          background: 'var(--color-bg, #fff)',
        }}
      >
        {/* Views rail */}
        <ViewsRail activeViewId={activeViewId} onSelectView={handleViewChange} />

        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {/* Toolbar */}
          <div
            style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--color-border, #e5e7eb)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexShrink: 0,
              flexWrap: 'wrap',
            }}
          >
            <FilterChipBar
              filter={filter}
              onChange={handleFilterChange}
              onAddFilter={() => setDrawerOpen(true)}
            />

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              {/* Sort selector */}
              <select
                aria-label="Sort by"
                value={sort ?? ''}
                onChange={(e) => { setSort(e.target.value || null); }}
                style={{
                  padding: '5px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #d1d5db)',
                  fontSize: 12,
                  background: 'var(--color-bg-card, #fff)',
                  color: 'var(--color-fg-secondary, #374151)',
                }}
              >
                <option value="">Sort: Default</option>
                <option value="created_at">Created</option>
                <option value="updated_at">Updated</option>
                <option value="priority">Priority</option>
                <option value="sla_target">SLA Target</option>
              </select>
              <select
                aria-label="Sort direction"
                value={sortDir ?? 'asc'}
                onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
                style={{
                  padding: '5px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #d1d5db)',
                  fontSize: 12,
                  background: 'var(--color-bg-card, #fff)',
                  color: 'var(--color-fg-secondary, #374151)',
                }}
              >
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </select>

              <button
                type="button"
                onClick={() => setSaveModalOpen(true)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #d1d5db)',
                  background: 'var(--color-bg-card, #fff)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--color-fg-secondary, #374151)',
                }}
              >
                Save view
              </button>

              {queueQuery.isFetching && !queueQuery.isLoading && (
                <span role="status" aria-live="polite" style={{ fontSize: 11, color: 'var(--color-muted, #9ca3af)' }}>
                  Refreshing…
                </span>
              )}
            </div>
          </div>

          {/* Stale data banner */}
          {isStale && (
            <div
              role="status"
              aria-live="polite"
              style={{
                padding: '6px 16px',
                background: '#fffbeb',
                borderBottom: '1px solid #fcd34d',
                fontSize: 12,
                color: '#92400e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}
            >
              <span>⚠ New tickets available — results may be out of date.</span>
              <button
                type="button"
                onClick={() => void queueQuery.refetch()}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#92400e',
                  textDecoration: 'underline',
                }}
              >
                Refresh
              </button>
            </div>
          )}

          {/* Bulk action bar */}
          <BulkActionBar
            selectedCount={selection.selectedCount}
            isSubmitting={bulkMutation.isPending}
            lastResult={lastBulkResult}
            onAction={handleBulkAction}
            onRetryFailed={handleRetryFailed}
            onDismissResult={() => setLastBulkResult(null)}
            onClearSelection={selection.clear}
          />

          {/* Ticket table */}
          <TicketTable
            rows={rows}
            totalCount={totalCount}
            isLoading={queueQuery.isLoading}
            isError={queueQuery.isError}
            errorMessage={errorMessage}
            hasNextPage={queueQuery.hasNextPage}
            isFetchingNextPage={queueQuery.isFetchingNextPage}
            onLoadMore={() => void queueQuery.fetchNextPage()}
            selected={selection.selected}
            isAllSelected={selection.isAllSelected}
            isIndeterminate={selection.isIndeterminate}
            onToggleRow={selection.toggle}
            onSelectAll={selection.selectAll}
            onClearSelection={selection.clear}
          />
        </div>

        {/* Add filter drawer */}
        <AddFilterDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          currentFilter={filter}
          onApply={handleFilterChange}
        />

        {/* Save view modal */}
        <SaveViewModal
          open={saveModalOpen}
          onClose={() => setSaveModalOpen(false)}
          currentFilter={filter}
          currentSort={sort}
          currentSortDir={sortDir}
          canCreateShared={false}
        />
      </div>
    </SlaClockProvider>
  );
}
