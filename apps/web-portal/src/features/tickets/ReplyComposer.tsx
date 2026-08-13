/**
 * ReplyComposer — portal reply form component — WO-090 AC5, AC6, AC9.
 *
 * Security invariants:
 *   - The `visibility` field is NEVER sent to the API. The server forces public.
 *   - Zod on the server also rejects any client-supplied visibility field.
 *   - Closed-ticket 422 TICKET_CLOSED is surfaced as an actionable message,
 *     not as a generic error.
 *   - Agent-only components (InternalNoteComposer, etc.) must never be imported here.
 */

'use client';

import React, { useState, useRef } from 'react';
import { usePortalAddComment } from '../../lib/api/tickets/hooks';
import { ApiError } from '@opsninja/api-client';

const MAX_BODY = 20_000;

export interface ReplyComposerProps {
  ticketId: string;
  /** Called after a reply is successfully stored. */
  onCommentAdded?: () => void;
  /** When true (e.g. ticket is closed + no reopen policy), composer is read-only. */
  disabled?: boolean;
}

export function ReplyComposer({ ticketId, onCommentAdded, disabled }: ReplyComposerProps) {
  const [body, setBody] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { mutate, isPending, error, isSuccess, reset } = usePortalAddComment(ticketId);

  const isClosed =
    error instanceof ApiError &&
    error.code === 'TICKET_CLOSED';

  const errorMessage = isClosed
    ? 'This ticket is closed. Please submit a new request if you need further help.'
    : error
    ? ((error as Error).message ?? 'Failed to send reply. Please try again.')
    : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > MAX_BODY || disabled || isPending) return;

    // visibility is intentionally omitted — server enforces 'public'
    mutate(
      { body: trimmed },
      {
        onSuccess: () => {
          setBody('');
          reset();
          onCommentAdded?.();
        },
      },
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Reply to ticket"
      data-testid="reply-composer"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div>
        <label
          htmlFor={`reply-body-${ticketId}`}
          style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 14 }}
        >
          Your reply
        </label>
        <textarea
          id={`reply-body-${ticketId}`}
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={MAX_BODY}
          disabled={disabled || isPending}
          placeholder="Describe the update or question…"
          aria-describedby={errorMessage ? `reply-error-${ticketId}` : undefined}
          data-testid="reply-body"
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid var(--portal-border, #d1d5db)',
            resize: 'vertical',
            fontSize: 14,
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
        <div
          aria-live="polite"
          style={{ textAlign: 'right', fontSize: 12, color: 'var(--portal-fg-muted, #9ca3af)' }}
        >
          {body.length.toLocaleString()}/{MAX_BODY.toLocaleString()} characters
        </div>
      </div>

      {errorMessage && (
        <p
          id={`reply-error-${ticketId}`}
          role="alert"
          data-testid="reply-error"
          style={{ color: 'var(--portal-danger, #dc2626)', margin: 0, fontSize: 14 }}
        >
          {errorMessage}
        </p>
      )}

      {isSuccess && !errorMessage && (
        <p
          role="status"
          data-testid="reply-success"
          style={{ color: 'var(--portal-success, #16a34a)', margin: 0, fontSize: 14 }}
        >
          Reply sent.
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={disabled || isPending || !body.trim()}
          data-testid="reply-submit"
          style={{
            padding: '8px 20px',
            borderRadius: 6,
            background: 'var(--portal-primary, #2563eb)',
            color: '#fff',
            border: 'none',
            cursor: disabled || !body.trim() ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            opacity: disabled || isPending || !body.trim() ? 0.6 : 1,
            fontSize: 14,
          }}
          aria-busy={isPending}
        >
          {isPending ? 'Sending…' : 'Send reply'}
        </button>
      </div>
    </form>
  );
}
