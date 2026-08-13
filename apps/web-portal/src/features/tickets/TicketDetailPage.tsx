/**
 * TicketDetailPage — portal ticket detail view — WO-090 AC3, AC4, AC7, AC9.
 *
 * Renders:
 *   - Ticket metadata (subject, status badge, SLA hint)
 *   - Public comment thread only — internal notes are structurally absent (AC7)
 *   - Attachment list with download links (pre-signed URL via AC8)
 *   - Status history timeline (audit trail projection)
 *   - ReplyComposer (AC5, AC6)
 *   - Empty-thread state when ticket has no public comments
 *
 * Security:
 *   - 404 is rendered as "not found" — never as a permission message (AC4)
 *   - visibility field never rendered — absent from API response (AC7)
 *   - All outgoing API calls respect the organisation-scoped service layer
 */

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { StatusBadge, SlaHint } from '@opsninja/ui-kit/portal';
import { ApiError } from '@opsninja/api-client';
import { usePortalTicketDetail } from '../../lib/api/tickets/hooks';
import { ReplyComposer } from './ReplyComposer';
import { AttachmentLink } from './AttachmentLink';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TicketDetailPageProps {
  ticketId: string;
}

export function TicketDetailPage({ ticketId }: TicketDetailPageProps) {
  const { data, isLoading, isError, error } = usePortalTicketDetail(ticketId);
  const [showHistory, setShowHistory] = useState(false);

  // ── Loading ──
  if (isLoading) {
    return (
      <section style={{ padding: 24 }}>
        <p role="status" data-testid="ticket-detail-loading" style={{ color: 'var(--portal-fg-muted, #6b7280)' }}>
          Loading ticket…
        </p>
      </section>
    );
  }

  // ── 404 / error ──
  if (isError) {
    const is404 =
      error instanceof ApiError && error.status === 404;

    return (
      <section style={{ padding: 24 }}>
        <p role="alert" data-testid="ticket-detail-error" style={{ color: 'var(--portal-danger, #dc2626)' }}>
          {is404
            ? 'Ticket not found.'
            : ((error as Error)?.message ?? 'Failed to load ticket. Please try again.')}
        </p>
        <Link href="/tickets" style={{ color: 'var(--portal-primary, #2563eb)', fontSize: 14 }}>
          ← Back to tickets
        </Link>
      </section>
    );
  }

  if (!data) return null;

  const isClosed = data.status === 'closed';

  return (
    <article aria-labelledby="ticket-subject" style={{ padding: 24, maxWidth: 800 }}>
      {/* ── Breadcrumb ── */}
      <nav aria-label="Breadcrumb" style={{ marginBottom: 16 }}>
        <Link href="/tickets" style={{ color: 'var(--portal-primary, #2563eb)', fontSize: 14 }}>
          ← My Tickets
        </Link>
      </nav>

      {/* ── Header ── */}
      <header style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <h1
            id="ticket-subject"
            style={{ margin: 0, fontSize: 20, fontWeight: 600, flex: 1, minWidth: 200 }}
            data-testid="ticket-subject"
          >
            {data.subject}
          </h1>
          <StatusBadge
            status={data.status as Parameters<typeof StatusBadge>[0]['status']}
          />
          {data.sla && (
            <SlaHint state={data.sla.state} />
          )}
        </div>

        {data.reference && (
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--portal-fg-muted, #6b7280)' }}>
            Ref: #{data.reference}
          </p>
        )}

        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--portal-fg-muted, #6b7280)' }}>
          Opened {formatDateShort(data.createdAt)}
          {data.categoryPath ? ` · ${data.categoryPath}` : ''}
        </p>

        {/* SLA targets — customer-safe projection */}
        {data.sla && (data.sla.firstResponseTargetAt || data.sla.resolutionTargetAt) && (
          <dl style={{ display: 'flex', gap: 16, margin: '8px 0 0', fontSize: 13 }}>
            {data.sla.firstResponseTargetAt && (
              <>
                <dt style={{ color: 'var(--portal-fg-muted, #6b7280)', marginRight: 4 }}>First response target:</dt>
                <dd style={{ margin: 0 }}>{formatDate(data.sla.firstResponseTargetAt)}</dd>
              </>
            )}
            {data.sla.resolutionTargetAt && (
              <>
                <dt style={{ color: 'var(--portal-fg-muted, #6b7280)', marginRight: 4 }}>Resolution target:</dt>
                <dd style={{ margin: 0 }}>{formatDate(data.sla.resolutionTargetAt)}</dd>
              </>
            )}
          </dl>
        )}
      </header>

      {/* ── AI Summary (conditional, per-tenant opt-in) ── */}
      {data.aiSummary && (
        <section aria-labelledby="ai-summary-heading" style={{ marginBottom: 24, padding: 16, borderRadius: 8, background: 'var(--portal-surface-raised, #f9fafb)', border: '1px solid var(--portal-border, #e5e7eb)' }}>
          <h2 id="ai-summary-heading" style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600 }}>
            Summary
          </h2>
          <p style={{ margin: 0, fontSize: 14 }}>{data.aiSummary}</p>
        </section>
      )}

      {/* ── Conversation thread ── */}
      <section aria-labelledby="conversation-heading" style={{ marginBottom: 24 }}>
        <h2 id="conversation-heading" style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>
          Conversation
        </h2>

        {data.comments.length === 0 ? (
          <p
            data-testid="no-comments"
            style={{ color: 'var(--portal-fg-muted, #6b7280)', fontSize: 14 }}
          >
            No public messages yet. Use the form below to reply.
          </p>
        ) : (
          <ol
            aria-label="Ticket conversation"
            style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {data.comments.map((comment) => (
              <li
                key={comment.id}
                data-testid={`comment-${comment.id}`}
                data-author-type={comment.authorType}
                style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--portal-border, #e5e7eb)',
                  background: comment.authorType === 'customer'
                    ? 'var(--portal-surface, #fff)'
                    : 'var(--portal-surface-raised, #f9fafb)',
                }}
              >
                <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                  <strong>{comment.authorDisplayName}</strong>
                  <time dateTime={comment.createdAt} style={{ color: 'var(--portal-fg-muted, #6b7280)' }}>
                    {formatDate(comment.createdAt)}
                  </time>
                </header>
                <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {comment.body}
                </p>
                {comment.attachments.length > 0 && (
                  <ul
                    aria-label="Attachments"
                    style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}
                  >
                    {comment.attachments.map((att) => (
                      <li key={att.id}>
                        <AttachmentLink attachmentId={att.id} displayName={att.displayName} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ── Reply composer ── */}
      <section aria-labelledby="reply-heading" style={{ marginBottom: 24 }}>
        <h2 id="reply-heading" style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>
          {isClosed ? 'Ticket Closed' : 'Send a Reply'}
        </h2>
        {isClosed ? (
          <p style={{ color: 'var(--portal-fg-muted, #6b7280)', fontSize: 14 }}>
            This ticket is closed. Need more help?{' '}
            <Link href="/submit" style={{ color: 'var(--portal-primary, #2563eb)' }}>
              Submit a new request
            </Link>
            .
          </p>
        ) : (
          <ReplyComposer ticketId={ticketId} />
        )}
      </section>

      {/* ── Status history ── */}
      {data.statusHistory.length > 0 && (
        <section aria-labelledby="history-heading">
          <button
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            aria-controls="status-history-list"
            data-testid="toggle-history"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--portal-primary, #2563eb)',
              fontSize: 14,
              padding: '4px 0',
              fontWeight: 500,
            }}
          >
            {showHistory ? '▾' : '▸'} Status history ({data.statusHistory.length})
          </button>

          {showHistory && (
            <ol
              id="status-history-list"
              aria-label="Status history"
              data-testid="status-history"
              style={{ listStyle: 'none', padding: 0, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              {data.statusHistory.map((entry, i) => (
                <li key={i} style={{ fontSize: 13, color: 'var(--portal-fg-muted, #6b7280)' }}>
                  <time dateTime={entry.at}>{formatDate(entry.at)}</time>
                  {' — '}
                  {entry.from ? (
                    <>
                      <span>{entry.from}</span>
                      {' → '}
                      <strong>{entry.to}</strong>
                    </>
                  ) : (
                    <>Opened as <strong>{entry.to}</strong></>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </article>
  );
}
