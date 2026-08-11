'use client';

/**
 * ConversationThread — WO-042.
 *
 * Agent-only module: renders the ticket thread mixing public replies and
 * internal notes. Internal notes are structurally distinct (label, border,
 * background) and announced via aria-label so visibility is never ambiguous.
 *
 * Cursor-paginated: "Load older" prepends earlier pages; scroll position is
 * preserved using a scroll-anchor ref after the page is prepended.
 *
 * CONSTRAINT: This file and its internal-note styles must NOT be imported by
 * apps/web-portal. The portal build boundary is enforced by the module path
 * (features/ticket — agent-only feature directory).
 */

import React, { useRef, useEffect, useCallback } from 'react';
import type { Comment } from '../../lib/api/tickets/types';

// ---------------------------------------------------------------------------
// Internal note styles (agent-only)
// ---------------------------------------------------------------------------

const NOTE_STYLES: Record<'public' | 'internal', React.CSSProperties> = {
  public: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 12,
  },
  internal: {
    background: '#fffbeb',
    border: '2px solid #fcd34d',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 12,
  },
};

// ---------------------------------------------------------------------------
// Single comment
// ---------------------------------------------------------------------------

interface CommentItemProps {
  comment: Comment;
}

function CommentItem({ comment }: CommentItemProps) {
  const isInternal = comment.visibility === 'internal';

  return (
    <article
      style={NOTE_STYLES[comment.visibility]}
      aria-label={
        isInternal
          ? `Internal note by ${comment.author.name} at ${new Date(comment.createdAt).toLocaleString()}`
          : `Reply by ${comment.author.name} at ${new Date(comment.createdAt).toLocaleString()}`
      }
      data-comment-id={comment.id}
      data-visibility={comment.visibility}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {isInternal && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#92400e',
              background: '#fef3c7',
              padding: '1px 6px',
              borderRadius: 4,
              letterSpacing: '0.05em',
            }}
            aria-hidden="true"
          >
            INTERNAL NOTE
          </span>
        )}
        <span style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>
          {comment.author.name}
        </span>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>
          {new Date(comment.createdAt).toLocaleString()}
        </span>
      </header>

      <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
        {comment.body}
      </div>

      {comment.attachments.length > 0 && (
        <ul
          style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', gap: 8, flexWrap: 'wrap' }}
          aria-label="Attachments"
        >
          {comment.attachments.map((att) => (
            <li key={att.id}>
              <a
                href={att.downloadUrl}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  color: '#2563eb',
                  textDecoration: 'underline',
                  padding: '2px 6px',
                  background: '#eff6ff',
                  borderRadius: 4,
                }}
              >
                📎 {att.filename}
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

interface ConversationThreadProps {
  comments: Comment[];
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadOlder: () => void;
}

export function ConversationThread({
  comments,
  hasMore,
  isFetchingMore,
  onLoadOlder,
}: ConversationThreadProps) {
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Preserve scroll position when older messages are prepended
  const handleLoadOlder = useCallback(() => {
    if (containerRef.current) {
      prevScrollHeightRef.current = containerRef.current.scrollHeight;
    }
    onLoadOlder();
  }, [onLoadOlder]);

  // After prepend: restore scroll position so user stays at the same spot
  useEffect(() => {
    if (prevScrollHeightRef.current > 0 && containerRef.current) {
      const delta = containerRef.current.scrollHeight - prevScrollHeightRef.current;
      containerRef.current.scrollTop += delta;
      prevScrollHeightRef.current = 0;
    }
  }, [comments.length]);

  if (comments.length === 0 && !isFetchingMore) {
    return (
      <div
        style={{ padding: '32px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}
        aria-live="polite"
      >
        No messages yet. Send the first reply below.
      </div>
    );
  }

  return (
    <section aria-label="Conversation thread">
      <div
        ref={containerRef}
        style={{ maxHeight: 480, overflowY: 'auto', padding: '8px 0' }}
      >
        {hasMore && (
          <div style={{ textAlign: 'center', padding: '8px 0', marginBottom: 8 }}>
            <button
              type="button"
              onClick={handleLoadOlder}
              disabled={isFetchingMore}
              style={{
                fontSize: 13,
                color: '#2563eb',
                background: 'none',
                border: 'none',
                cursor: isFetchingMore ? 'not-allowed' : 'pointer',
                textDecoration: 'underline',
              }}
              aria-busy={isFetchingMore}
            >
              {isFetchingMore ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        )}

        {comments.map((c) => (
          <CommentItem key={c.id} comment={c} />
        ))}

        {/* Scroll anchor for auto-scrolling to newest */}
        <div ref={scrollAnchorRef} />
      </div>
    </section>
  );
}
