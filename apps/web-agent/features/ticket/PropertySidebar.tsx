'use client';

/**
 * PropertySidebar — WO-042.
 *
 * Editable ticket properties: priority, assignee, category, tags, custom fields.
 *
 * Conflict handling (409):
 *   - Every PATCH carries the current version number.
 *   - A 409 response triggers the conflict banner with a reload-and-merge action.
 *   - The agent's unsaved edits are never silently discarded — they remain in
 *     the form after the server rejects the PATCH so the agent can review and
 *     re-submit with awareness.
 *   - Optimistic update: local state updates immediately; rolls back on any error.
 */

import React, { useReducer, useCallback, useEffect } from 'react';
import type { TicketDetail, TicketPriority } from '../../lib/api/tickets/types';
import {
  conflictReducer,
  makeInitialConflictState,
  type ConflictAction,
} from './conflictReducer';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PropertySidebarProps {
  ticket: TicketDetail;
  onUpdate: (payload: {
    version: number;
    priority?: TicketPriority;
    assigneeUserId?: string | null;
    categoryId?: string | null;
    tags?: string[];
    customFields?: Record<string, unknown>;
  }) => Promise<TicketDetail>;
  onConflictMerge?: (serverData: TicketDetail) => void;
}

// ---------------------------------------------------------------------------
// Priority options
// ---------------------------------------------------------------------------

const PRIORITY_OPTIONS: TicketPriority[] = ['P1', 'P2', 'P3', 'P4'];

const PRIORITY_COLORS: Record<TicketPriority, string> = {
  P1: '#dc2626',
  P2: '#d97706',
  P3: '#2563eb',
  P4: '#6b7280',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PropertySidebar({ ticket, onUpdate, onConflictMerge }: PropertySidebarProps) {
  const [state, dispatch] = useReducer(
    conflictReducer,
    ticket,
    makeInitialConflictState,
  );

  // Keep version in sync when ticket refreshes from server
  useEffect(() => {
    if (ticket.version !== state.currentVersion && !state.conflict) {
      dispatch({ type: 'SAVE_SUCCESS', serverVersion: ticket.version });
    }
  }, [ticket.version, state.currentVersion, state.conflict]);

  const currentPriority = (state.localEdits.priority ?? ticket.priority) as TicketPriority;
  const currentAssignee = state.localEdits.assigneeUserId !== undefined
    ? state.localEdits.assigneeUserId
    : ticket.assigneeUserId;

  const handlePriorityChange = useCallback(
    async (priority: TicketPriority) => {
      dispatch({ type: 'EDIT', field: 'priority', value: priority });
      try {
        const updated = await onUpdate({ version: state.currentVersion, priority });
        dispatch({ type: 'SAVE_SUCCESS', serverVersion: updated.version });
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 409) {
          const serverVersion = (err as { body?: { error?: { details?: Array<{ currentVersion?: number }> } } })
            ?.body?.error?.details?.[0]?.currentVersion ?? state.currentVersion + 1;
          dispatch({ type: 'SAVE_CONFLICT', serverVersion });
        }
        // Revert optimistic edit on any non-409 error
        if (status !== 409) {
          dispatch({ type: 'RESET' });
        }
      }
    },
    [onUpdate, state.currentVersion],
  );

  const handleMerge = useCallback(() => {
    dispatch({ type: 'MERGE', serverData: ticket });
    onConflictMerge?.(ticket);
  }, [ticket, onConflictMerge]);

  return (
    <aside
      aria-label="Ticket properties"
      style={{
        width: 240,
        flexShrink: 0,
        borderLeft: '1px solid #e5e7eb',
        padding: 16,
        background: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* Conflict banner */}
      {state.conflict && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 12,
          }}
        >
          <p style={{ margin: '0 0 6px', fontWeight: 700, color: '#92400e' }}>
            ⚠ Edit conflict — ticket was updated by another agent
            {state.serverVersion != null && ` (version ${state.serverVersion})`}
          </p>
          <p style={{ margin: '0 0 6px', color: '#78350f' }}>
            Your unsaved changes are preserved below.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={handleMerge}
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: 4,
                border: 'none',
                background: '#d97706',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Reload &amp; merge
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: 'DISMISS_CONFLICT' })}
              style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 4,
                border: '1px solid #d1d5db',
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Priority */}
      <div>
        <label
          style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6, letterSpacing: '0.05em' }}
        >
          PRIORITY
        </label>
        <div role="group" aria-label="Priority" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {PRIORITY_OPTIONS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => void handlePriorityChange(p)}
              aria-pressed={currentPriority === p}
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: 4,
                border: `2px solid ${currentPriority === p ? PRIORITY_COLORS[p] : '#e5e7eb'}`,
                background: currentPriority === p ? `${PRIORITY_COLORS[p]}15` : '#fff',
                color: currentPriority === p ? PRIORITY_COLORS[p] : '#6b7280',
                cursor: 'pointer',
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Assignee */}
      <div>
        <label
          style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6, letterSpacing: '0.05em' }}
        >
          ASSIGNEE
        </label>
        <div style={{ fontSize: 13, color: '#374151' }}>
          {currentAssignee ? ticket.assigneeName ?? currentAssignee : (
            <span style={{ color: '#9ca3af' }}>Unassigned</span>
          )}
        </div>
      </div>

      {/* Category */}
      <div>
        <label
          style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6, letterSpacing: '0.05em' }}
        >
          CATEGORY
        </label>
        <div style={{ fontSize: 13, color: '#374151' }}>
          {ticket.categoryPath ?? <span style={{ color: '#9ca3af' }}>Uncategorised</span>}
        </div>
      </div>

      {/* Tags */}
      <div>
        <label
          style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6, letterSpacing: '0.05em' }}
        >
          TAGS
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {ticket.tags.length === 0
            ? <span style={{ fontSize: 12, color: '#9ca3af' }}>No tags</span>
            : ticket.tags.map((t) => (
              <span
                key={t.id}
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  borderRadius: 10,
                  background: '#eff6ff',
                  color: '#1d4ed8',
                }}
              >
                {t.name}
              </span>
            ))
          }
        </div>
      </div>

      {/* Allowed transitions */}
      <div>
        <label
          style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6, letterSpacing: '0.05em' }}
        >
          STATUS
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 4,
              background: '#dbeafe',
              color: '#1e40af',
              display: 'inline-block',
              alignSelf: 'flex-start',
            }}
          >
            {ticket.status.replace('_', ' ')}
          </span>
          <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
            {ticket.allowedTransitions.length} transition{ticket.allowedTransitions.length !== 1 ? 's' : ''} available
          </p>
        </div>
      </div>

      {/* Version indicator */}
      <div style={{ fontSize: 11, color: '#d1d5db', marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #f3f4f6' }}>
        Version {state.currentVersion}
      </div>
    </aside>
  );
}
