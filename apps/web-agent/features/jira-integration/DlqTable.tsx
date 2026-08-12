'use client';

/**
 * DlqTable — cursor-paginated dead-letter queue table with filters, single
 * and capped batch replay, confirmation dialog, and per-item success/failure
 * toast (WO-058).
 *
 * Accessibility: keyboard-navigable rows, aria-live region for action outcomes,
 * no colour-only encoding.
 */

import React, { useState } from 'react';
import type { DlqItem, ReplayResult } from '../../lib/api/jira/types';
import {
  useDlqPage,
  useReplayDlqItem,
  useReplayDlqBatch,
  DLQ_BATCH_REPLAY_CAP,
  type ApiError,
} from '../../lib/api/jira/hooks';

interface Props {
  connectionId?: string;
  canWrite: boolean;
  stale?: boolean;
}

interface ToastItem {
  id: string;
  success: boolean;
  error: string | null;
}

const PAGE_SIZE = 25;

export function DlqTable({ connectionId, canWrite, stale }: Props) {
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dlqQuery = useDlqPage(
    connectionId,
    eventTypeFilter || undefined,
    PAGE_SIZE,
  );

  const replayItem = useReplayDlqItem();
  const replayBatch = useReplayDlqBatch();

  const pages = dlqQuery.data?.pages ?? [];
  const items: DlqItem[] = pages.flatMap((p) => p.data);
  const total = pages[pages.length - 1]?.total ?? 0;
  const hasNextPage = dlqQuery.hasNextPage;

  function addToast(result: ReplayResult) {
    const t: ToastItem = { id: result.id, success: result.success, error: result.error };
    setToasts((prev) => [...prev, t]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id || x.success !== t.success)), 5000);
  }

  function handleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(items.map((i) => i.id)));
    } else {
      setSelectedIds(new Set());
    }
  }

  function handleSelectRow(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleSingleReplay(eventId: string) {
    try {
      const result = await replayItem.mutateAsync(eventId);
      addToast(result);
    } catch (err) {
      addToast({ id: eventId, success: false, error: (err as Error).message });
    }
  }

  async function handleBatchReplay() {
    const ids = Array.from(selectedIds).slice(0, DLQ_BATCH_REPLAY_CAP);
    setBatchConfirm(false);
    try {
      const res = await replayBatch.mutateAsync(ids);
      for (const r of res.results) addToast(r);
      setSelectedIds(new Set());
    } catch (err) {
      addToast({ id: 'batch', success: false, error: (err as Error).message });
    }
  }

  const isLoading = dlqQuery.isLoading;
  const error = dlqQuery.error as ApiError | null;

  return (
    <section aria-label="Dead-letter queue">
      {/* Stale badge */}
      {stale && (
        <span
          role="status"
          aria-label="DLQ data may be stale"
          style={{
            display: 'inline-block',
            marginBottom: 8,
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 8px',
            background: '#fffbeb',
            color: '#d97706',
            border: '1px solid #d97706',
            borderRadius: 4,
          }}
        >
          STALE
        </span>
      )}

      {/* Header + filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-fg-primary, #111827)', margin: 0 }}>
          Dead-Letter Queue
          {total > 0 && (
            <span
              aria-label={`${total} failed events`}
              style={{
                marginLeft: 8,
                fontSize: 12,
                padding: '1px 7px',
                borderRadius: 10,
                background: '#fef2f2',
                color: '#dc2626',
                fontWeight: 600,
              }}
            >
              {total}
            </span>
          )}
        </h3>

        <input
          type="text"
          placeholder="Filter by event type…"
          value={eventTypeFilter}
          onChange={(e) => setEventTypeFilter(e.target.value)}
          aria-label="Filter DLQ by event type"
          style={{
            padding: '4px 10px',
            borderRadius: 5,
            border: '1px solid var(--color-border, #e5e7eb)',
            fontSize: 13,
            minWidth: 180,
          }}
        />

        {canWrite && selectedIds.size > 0 && (
          <button
            type="button"
            onClick={() => setBatchConfirm(true)}
            aria-label={`Replay ${Math.min(selectedIds.size, DLQ_BATCH_REPLAY_CAP)} selected events`}
            style={{
              marginLeft: 'auto',
              padding: '5px 14px',
              borderRadius: 5,
              border: 'none',
              background: 'var(--color-primary, #4f46e5)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Replay {Math.min(selectedIds.size, DLQ_BATCH_REPLAY_CAP)} selected
            {selectedIds.size > DLQ_BATCH_REPLAY_CAP ? ` (capped at ${DLQ_BATCH_REPLAY_CAP})` : ''}
          </button>
        )}
      </div>

      {/* Batch confirm dialog */}
      {batchConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm batch replay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 8,
              padding: '24px 28px',
              maxWidth: 400,
              width: '100%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h4 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>Confirm batch replay</h4>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>
              You are about to replay {Math.min(selectedIds.size, DLQ_BATCH_REPLAY_CAP)} event
              {selectedIds.size !== 1 ? 's' : ''}. Each event will be re-enqueued to the sync
              worker. This action is audited.
              {selectedIds.size > DLQ_BATCH_REPLAY_CAP && (
                <> Only the first {DLQ_BATCH_REPLAY_CAP} will be replayed.</>
              )}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setBatchConfirm(false)}
                style={{
                  padding: '6px 16px',
                  border: '1px solid var(--color-border, #e5e7eb)',
                  borderRadius: 5,
                  background: '#fff',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleBatchReplay()}
                style={{
                  padding: '6px 16px',
                  border: 'none',
                  borderRadius: 5,
                  background: '#dc2626',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Replay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <p aria-live="polite" style={{ color: 'var(--color-fg-muted, #6b7280)', fontSize: 13 }}>
          Loading…
        </p>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div role="alert" style={{ color: '#dc2626', fontSize: 13, padding: '8px 12px', background: '#fef2f2', borderRadius: 6 }}>
          Failed to load DLQ: {error.message}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && items.length === 0 && (
        <div
          aria-label="No failed events in dead-letter queue"
          style={{
            padding: '32px',
            textAlign: 'center',
            color: 'var(--color-fg-muted, #6b7280)',
            fontSize: 13,
            border: '1px dashed var(--color-border, #e5e7eb)',
            borderRadius: 8,
          }}
        >
          ✓ No failed events
        </div>
      )}

      {/* Table */}
      {items.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
            aria-label="Dead-letter queue events"
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border, #e5e7eb)' }}>
                {canWrite && (
                  <th style={{ padding: '8px 12px', textAlign: 'left', width: 36 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all events"
                      checked={selectedIds.size === items.length && items.length > 0}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                  </th>
                )}
                <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Event ID</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Type</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Issue</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Attempts</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Last Error</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Received</th>
                {canWrite && (
                  <th style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--color-fg-muted, #6b7280)', fontWeight: 500 }}>Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  style={{ borderBottom: '1px solid var(--color-border, #f3f4f6)' }}
                >
                  {canWrite && (
                    <td style={{ padding: '8px 12px' }}>
                      <input
                        type="checkbox"
                        aria-label={`Select event ${item.jiraEventId}`}
                        checked={selectedIds.has(item.id)}
                        onChange={(e) => handleSelectRow(item.id, e.target.checked)}
                      />
                    </td>
                  )}
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--color-fg-muted, #6b7280)' }}>
                    {item.jiraEventId.slice(0, 12)}…
                  </td>
                  <td style={{ padding: '8px 12px' }}>{item.eventType}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--color-primary, #4f46e5)' }}>
                    {item.jiraIssueKey ?? '—'}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                    <span
                      aria-label={`${item.attempts} delivery attempts`}
                      style={{ color: item.attempts >= 3 ? '#dc2626' : 'var(--color-fg-primary, #111827)' }}
                    >
                      {item.attempts}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: '8px 12px',
                      maxWidth: 200,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: '#dc2626',
                    }}
                    title={item.lastError ?? undefined}
                  >
                    {item.lastError ?? '—'}
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--color-fg-muted, #6b7280)', whiteSpace: 'nowrap' }}>
                    {new Date(item.receivedAt).toLocaleString()}
                  </td>
                  {canWrite && (
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => void handleSingleReplay(item.id)}
                        disabled={replayItem.isPending}
                        aria-label={`Replay event ${item.jiraEventId}`}
                        style={{
                          padding: '3px 10px',
                          borderRadius: 4,
                          border: '1px solid var(--color-border, #e5e7eb)',
                          background: '#fff',
                          fontSize: 12,
                          cursor: replayItem.isPending ? 'not-allowed' : 'pointer',
                          opacity: replayItem.isPending ? 0.6 : 1,
                        }}
                      >
                        Replay
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Load more */}
      {hasNextPage && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => void dlqQuery.fetchNextPage()}
            disabled={dlqQuery.isFetchingNextPage}
            aria-label="Load more DLQ events"
            style={{
              padding: '6px 18px',
              borderRadius: 5,
              border: '1px solid var(--color-border, #e5e7eb)',
              background: '#fff',
              fontSize: 13,
              cursor: dlqQuery.isFetchingNextPage ? 'not-allowed' : 'pointer',
            }}
          >
            {dlqQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {/* Aria-live toast region */}
      <div role="status" aria-live="polite" aria-atomic="false" style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 60, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {toasts.map((t, i) => (
          <div
            key={i}
            style={{
              padding: '10px 16px',
              borderRadius: 6,
              background: t.success ? '#f0fdf4' : '#fef2f2',
              color: t.success ? '#16a34a' : '#dc2626',
              border: `1px solid ${t.success ? '#86efac' : '#fca5a5'}`,
              fontSize: 13,
              fontWeight: 500,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
          >
            {t.success
              ? `✓ Event ${t.id.slice(0, 8)}… replayed`
              : `✗ Replay failed: ${t.error ?? 'Unknown error'}`}
          </div>
        ))}
      </div>
    </section>
  );
}
