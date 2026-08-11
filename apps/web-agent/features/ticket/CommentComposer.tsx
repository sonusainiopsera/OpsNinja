'use client';

/**
 * CommentComposer — WO-042.
 *
 * Public reply / internal note composer with:
 *   - Visibility toggle (public | internal) — internal guarded by permission
 *   - Attachment attach (opens AttachmentUploader)
 *   - Optimistic append: comment appears immediately, rolls back on failure
 *   - Empty-body submit prevention
 *
 * CONSTRAINT: Internal-note affordance must not be accessible to principals
 * that lack the required permission.  The guard is enforced here rather than
 * relying on backend rejection so the toggle is simply absent from the DOM,
 * not merely disabled (403 existence non-disclosure).
 */

import React, { useState, useRef, useCallback } from 'react';
import type { CommentVisibility } from '../../lib/api/tickets/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CommentComposerProps {
  /** True when the current user has the permission to post internal notes. */
  canPostInternal: boolean;
  /** Whether a submit is in flight. */
  isSubmitting: boolean;
  /** Error from the last failed submit. */
  submitError: string | null;
  onSubmit: (body: string, visibility: CommentVisibility, attachmentIds: string[]) => void;
  /** Called when agent wants to attach a file before composing. */
  onAttach?: () => void;
  pendingAttachmentIds?: string[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommentComposer({
  canPostInternal,
  isSubmitting,
  submitError,
  onSubmit,
  onAttach,
  pendingAttachmentIds = [],
}: CommentComposerProps) {
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<CommentVisibility>('public');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isInternal = visibility === 'internal';

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = body.trim();
      if (!trimmed || isSubmitting) return;
      onSubmit(trimmed, visibility, pendingAttachmentIds);
      setBody('');
    },
    [body, visibility, pendingAttachmentIds, isSubmitting, onSubmit],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+Enter / Cmd+Enter submits
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const trimmed = body.trim();
        if (trimmed && !isSubmitting) {
          onSubmit(trimmed, visibility, pendingAttachmentIds);
          setBody('');
        }
      }
    },
    [body, visibility, pendingAttachmentIds, isSubmitting, onSubmit],
  );

  return (
    <section
      aria-label="Reply composer"
      style={{
        border: isInternal ? '2px solid #fcd34d' : '1px solid #e5e7eb',
        borderRadius: 8,
        background: isInternal ? '#fffdf0' : '#ffffff',
        padding: 12,
        marginTop: 12,
      }}
    >
      {/* Visibility toggle */}
      {canPostInternal && (
        <div
          role="group"
          aria-label="Reply visibility"
          style={{ display: 'flex', gap: 6, marginBottom: 8 }}
        >
          <button
            type="button"
            onClick={() => setVisibility('public')}
            aria-pressed={visibility === 'public'}
            style={{
              fontSize: 12,
              padding: '3px 10px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
              background: visibility === 'public' ? '#2563eb' : '#ffffff',
              color: visibility === 'public' ? '#ffffff' : '#374151',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Public reply
          </button>
          <button
            type="button"
            onClick={() => setVisibility('internal')}
            aria-pressed={visibility === 'internal'}
            style={{
              fontSize: 12,
              padding: '3px 10px',
              borderRadius: 4,
              border: '1px solid #d1d5db',
              background: visibility === 'internal' ? '#d97706' : '#ffffff',
              color: visibility === 'internal' ? '#ffffff' : '#374151',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            🔒 Internal note
          </button>
        </div>
      )}

      {isInternal && (
        <p
          role="status"
          style={{ fontSize: 12, color: '#92400e', margin: '0 0 6px', fontWeight: 600 }}
        >
          Internal note — only agents can see this
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={4}
          placeholder={isInternal ? 'Add an internal note…' : 'Write a public reply…'}
          aria-label={isInternal ? 'Internal note body' : 'Reply body'}
          aria-required="true"
          disabled={isSubmitting}
          style={{
            width: '100%',
            resize: 'vertical',
            fontSize: 14,
            padding: '8px 10px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            boxSizing: 'border-box',
            fontFamily: 'inherit',
            background: isSubmitting ? '#f9fafb' : '#ffffff',
          }}
        />

        {submitError && (
          <p
            role="alert"
            style={{ fontSize: 12, color: '#dc2626', margin: '4px 0 0' }}
          >
            {submitError}
          </p>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {onAttach && (
              <button
                type="button"
                onClick={onAttach}
                style={{
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: '1px solid #d1d5db',
                  background: '#f9fafb',
                  cursor: 'pointer',
                }}
                aria-label="Attach files"
              >
                📎 Attach
              </button>
            )}
            {pendingAttachmentIds.length > 0 && (
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {pendingAttachmentIds.length} file{pendingAttachmentIds.length > 1 ? 's' : ''} attached
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={!body.trim() || isSubmitting}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '6px 18px',
              borderRadius: 6,
              border: 'none',
              background: !body.trim() || isSubmitting ? '#d1d5db' : '#2563eb',
              color: !body.trim() || isSubmitting ? '#9ca3af' : '#ffffff',
              cursor: !body.trim() || isSubmitting ? 'not-allowed' : 'pointer',
            }}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Sending…' : isInternal ? 'Post note' : 'Send reply'}
          </button>
        </div>
      </form>
    </section>
  );
}
