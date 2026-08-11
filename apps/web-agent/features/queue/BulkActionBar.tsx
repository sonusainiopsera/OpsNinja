'use client';

/**
 * BulkActionBar — action bar shown when 1+ rows are selected.
 *
 * Actions: Assign, Set Priority, Add Tag, Close
 * Surfaces per-row success/failure results after submission.
 * Failed rows are listed with reason + retry button.
 */

import React, { useState } from 'react';
import type { BulkActionType, TicketPriority, BulkActionResponse } from '../../lib/api/tickets/types';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ResultSummaryProps {
  result: BulkActionResponse;
  onRetryFailed: (failedIds: string[]) => void;
  onDismiss: () => void;
}

function ResultSummary({ result, onRetryFailed, onDismiss }: ResultSummaryProps) {
  const failed = result.results.filter((r) => !r.success);
  const failedIds = failed.map((r) => r.ticketId);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Bulk action result: ${result.succeeded} succeeded, ${result.failed} failed`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 12px',
        background: result.failed > 0 ? '#fff7ed' : '#f0fdf4',
        border: `1px solid ${result.failed > 0 ? '#fed7aa' : '#bbf7d0'}`,
        borderRadius: 6,
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>
          ✓ {result.succeeded} updated
          {result.failed > 0 && (
            <span style={{ color: '#dc2626', marginLeft: 8 }}>
              · {result.failed} failed
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {result.failed > 0 && (
            <button
              type="button"
              onClick={() => onRetryFailed(failedIds)}
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid #f97316',
                background: 'transparent',
                color: '#c2410c',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Retry failed ({result.failed})
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss result"
            onClick={onDismiss}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              color: 'var(--color-muted, #6b7280)',
              padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>
      </div>
      {result.failed > 0 && (
        <ul style={{ margin: 0, padding: '0 0 0 16px', listStyle: 'disc', fontSize: 12, color: '#dc2626' }}>
          {failed.map((r) => (
            <li key={r.ticketId}>
              #{r.ticketId}: {r.error?.message ?? r.error?.code ?? 'Unknown error'}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BulkActionBar
// ---------------------------------------------------------------------------

interface BulkActionBarProps {
  selectedCount: number;
  isSubmitting: boolean;
  lastResult: BulkActionResponse | null;
  onAction: (action: BulkActionType, opts: {
    assigneeUserId?: string | null;
    priority?: TicketPriority;
    tagId?: string;
  }) => void;
  onRetryFailed: (ids: string[]) => void;
  onDismissResult: () => void;
  onClearSelection: () => void;
}

export function BulkActionBar({
  selectedCount,
  isSubmitting,
  lastResult,
  onAction,
  onRetryFailed,
  onDismissResult,
  onClearSelection,
}: BulkActionBarProps) {
  const [showAssignInput, setShowAssignInput] = useState(false);
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');

  if (selectedCount === 0) return null;

  const PRIORITIES: TicketPriority[] = ['P1', 'P2', 'P3', 'P4'];

  const PRIORITY_COLORS: Record<TicketPriority, string> = {
    P1: '#dc2626', P2: '#ea580c', P3: '#ca8a04', P4: '#6b7280',
  };

  return (
    <div
      role="toolbar"
      aria-label={`Bulk actions for ${selectedCount} selected tickets`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '8px 16px',
        borderBottom: '1px solid var(--color-border, #e5e7eb)',
        background: 'var(--color-primary-soft, #eef2ff)',
        flexShrink: 0,
      }}
    >
      {/* Action row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary, #4f46e5)', marginRight: 4 }}>
          {selectedCount} selected
        </span>

        {/* Assign button + inline input */}
        {showAssignInput ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onAction('assign', { assigneeUserId: assigneeId.trim() || null });
              setShowAssignInput(false);
              setAssigneeId('');
            }}
            style={{ display: 'flex', gap: 6, alignItems: 'center' }}
          >
            <input
              type="text"
              placeholder="User ID or leave blank to unassign"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              aria-label="Assignee user ID"
              autoFocus
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid var(--color-border, #d1d5db)',
                fontSize: 12,
                width: 220,
              }}
            />
            <button
              type="submit"
              disabled={isSubmitting}
              style={actionBtnStyle('#4f46e5', '#fff')}
            >
              Assign
            </button>
            <button type="button" onClick={() => setShowAssignInput(false)} style={cancelBtnStyle}>
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => setShowAssignInput(true)}
            style={actionBtnStyle()}
          >
            Assign…
          </button>
        )}

        {/* Priority dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => setShowPriorityMenu((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={showPriorityMenu}
            style={actionBtnStyle()}
          >
            Set Priority ▾
          </button>
          {showPriorityMenu && (
            <ul
              role="menu"
              aria-label="Set priority"
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 4,
                background: 'var(--color-bg-card, #fff)',
                border: '1px solid var(--color-border, #e5e7eb)',
                borderRadius: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                zIndex: 50,
                listStyle: 'none',
                margin: 0,
                padding: '4px 0',
                minWidth: 100,
              }}
            >
              {PRIORITIES.map((p) => (
                <li key={p} role="none">
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      onAction('set_priority', { priority: p });
                      setShowPriorityMenu(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 14px',
                      width: '100%',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 13,
                      color: PRIORITY_COLORS[p],
                      fontWeight: 600,
                    }}
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Close tickets */}
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => {
            if (window.confirm(`Close ${selectedCount} ticket${selectedCount === 1 ? '' : 's'}?`)) {
              onAction('close', {});
            }
          }}
          style={actionBtnStyle('#dc2626', '#fff')}
        >
          Close tickets
        </button>

        <span style={{ flex: 1 }} />

        {isSubmitting && (
          <span role="status" aria-live="polite" style={{ fontSize: 12, color: 'var(--color-muted, #6b7280)' }}>
            Applying…
          </span>
        )}

        <button
          type="button"
          onClick={onClearSelection}
          aria-label="Clear selection"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--color-muted, #6b7280)',
            textDecoration: 'underline',
          }}
        >
          Clear
        </button>
      </div>

      {/* Result summary */}
      {lastResult && (
        <ResultSummary
          result={lastResult}
          onRetryFailed={onRetryFailed}
          onDismiss={onDismissResult}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function actionBtnStyle(bg = 'var(--color-bg-card, #fff)', color = 'var(--color-fg-secondary, #374151)'): React.CSSProperties {
  return {
    padding: '5px 12px',
    borderRadius: 4,
    border: '1px solid var(--color-border, #d1d5db)',
    background: bg,
    color,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

const cancelBtnStyle: React.CSSProperties = {
  padding: '5px 8px',
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  fontSize: 12,
  cursor: 'pointer',
  color: 'var(--color-muted, #6b7280)',
};
