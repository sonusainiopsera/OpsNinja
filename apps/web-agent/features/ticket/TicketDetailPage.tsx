'use client';

/**
 * TicketDetailPage — WO-042.
 *
 * Main composition for the ticket detail workspace.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────┐
 *   │ Header: #number · subject · status · priority · org │
 *   ├──────────────────────────────────┬──────────────────┤
 *   │ Main (flex: 1)                   │ PropertySidebar  │
 *   │  ConversationThread              │ (240px)          │
 *   │  CommentComposer                 │                  │
 *   │  AttachmentUploader              │ SlaTimelineCard  │
 *   │  JiraLinkCard                    │                  │
 *   └──────────────────────────────────┴──────────────────┘
 *
 * States handled: loading skeleton, 404 not-found, error, loaded.
 * Allowed transitions come from the server payload — no lifecycle rules
 * are hard-coded in this component.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  useTicketDetail,
  useTicketComments,
  useAddComment,
  useUpdateTicket,
  useResolveTicket,
  usePresignAttachment,
  useFinalizeAttachment,
} from '../../lib/api/tickets/hooks';
import type { TicketDetail, TicketPriority } from '../../lib/api/tickets/types';
import { ConversationThread }   from './ConversationThread';
import { CommentComposer }      from './CommentComposer';
import { AttachmentUploader }   from './AttachmentUploader';
import { SlaTimelineCard }      from './SlaTimelineCard';
import { JiraLinkCard }         from './JiraLinkCard';
import { PropertySidebar }      from './PropertySidebar';
import { ResolveModal }         from './ResolveModal';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  open:                { bg: '#dbeafe', color: '#1e40af' },
  in_progress:         { bg: '#d1fae5', color: '#065f46' },
  pending_customer:    { bg: '#fef3c7', color: '#92400e' },
  pending_engineering: { bg: '#ede9fe', color: '#5b21b6' },
  resolved:            { bg: '#e5e7eb', color: '#374151' },
  closed:              { bg: '#f3f4f6', color: '#9ca3af' },
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: '#dc2626',
  P2: '#d97706',
  P3: '#2563eb',
  P4: '#6b7280',
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading ticket details" style={{ padding: 24 }}>
      {[80, 60, 40, 70, 50].map((w, i) => (
        <div
          key={i}
          style={{
            height: 14,
            width: `${w}%`,
            background: '#f3f4f6',
            borderRadius: 4,
            marginBottom: 12,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TicketDetailPage
// ---------------------------------------------------------------------------

interface TicketDetailPageProps {
  ticketId: string;
}

export function TicketDetailPage({ ticketId }: TicketDetailPageProps) {
  const [resolveOpen, setResolveOpen]   = useState(false);
  const [pendingAttachIds, setPendingAttachIds] = useState<string[]>([]);
  const [composerError, setComposerError] = useState<string | null>(null);
  const resolveButtonRef = useRef<HTMLButtonElement>(null);

  // ── Data fetching ──────────────────────────────────────────────────────
  const { data: ticket, isLoading, error } = useTicketDetail(ticketId);
  const commentsQuery = useTicketComments(ticketId);
  const allComments = commentsQuery.data?.pages.flatMap((p) => p.data) ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────
  const addComment      = useAddComment(ticketId);
  const updateTicket    = useUpdateTicket(ticketId);
  const resolveTicket   = useResolveTicket(ticketId);
  const presignMutation = usePresignAttachment(ticketId);
  const finalizeMutation = useFinalizeAttachment(ticketId);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleComment = useCallback(
    (body: string, visibility: 'public' | 'internal', attachmentIds: string[]) => {
      setComposerError(null);
      addComment.mutate(
        { body, visibility, attachmentIds },
        {
          onError: (err) => {
            setComposerError(
              (err as { message?: string }).message ?? 'Failed to send reply. Please try again.',
            );
          },
        },
      );
    },
    [addComment],
  );

  const handleUpdate = useCallback(
    (payload: {
      version: number;
      priority?: TicketPriority;
      assigneeUserId?: string | null;
      categoryId?: string | null;
      tags?: string[];
      customFields?: Record<string, unknown>;
    }): Promise<TicketDetail> =>
      new Promise((resolve, reject) =>
        updateTicket.mutate(payload, { onSuccess: resolve, onError: reject }),
      ),
    [updateTicket],
  );

  const handleResolve = useCallback(
    (note: string, affectedAreaTagIds: string[]) => {
      if (!ticket) return;
      resolveTicket.mutate(
        { version: ticket.version, resolutionNote: note, affectedAreaTagIds },
        { onSuccess: () => setResolveOpen(false) },
      );
    },
    [ticket, resolveTicket],
  );

  const handlePresign = useCallback(
    (filename: string, contentType: string, sizeBytes: number) =>
      presignMutation.mutateAsync({ filename, contentType, sizeBytes }),
    [presignMutation],
  );

  const handleFinalize = useCallback(
    (uploadId: string, filename: string, contentType: string, sizeBytes: number) =>
      finalizeMutation.mutateAsync({ uploadId, filename, contentType, sizeBytes }),
    [finalizeMutation],
  );

  // ── Render states ──────────────────────────────────────────────────────

  if (isLoading) return <LoadingSkeleton />;

  if (error) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 403) {
      return (
        <div
          role="main"
          style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}
        >
          <p style={{ fontSize: 24, margin: '0 0 8px' }}>🔍</p>
          <h1 style={{ fontSize: 20, margin: '0 0 8px', color: '#111827' }}>
            Ticket not found
          </h1>
          <p style={{ fontSize: 14 }}>
            This ticket doesn't exist or you don't have access to it.
          </p>
        </div>
      );
    }
    return (
      <div role="alert" style={{ padding: 24, color: '#dc2626' }}>
        <p style={{ fontWeight: 700 }}>Failed to load ticket</p>
        <p style={{ fontSize: 13 }}>{(error as Error).message}</p>
      </div>
    );
  }

  if (!ticket) return null;

  const isClosed = ticket.status === 'resolved' || ticket.status === 'closed';
  const statusStyle = STATUS_COLORS[ticket.status] ?? STATUS_COLORS['open']!;

  // ── Resolved page ──────────────────────────────────────────────────────

  return (
    <main aria-label={`Ticket #${ticket.ticketNumber}`} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid #e5e7eb',
          background: '#fff',
          flexShrink: 0,
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#9ca3af' }}>
              #{ticket.ticketNumber}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                ...statusStyle,
              }}
            >
              {ticket.status.replace('_', ' ')}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: PRIORITY_COLORS[ticket.priority] ?? '#6b7280',
              }}
            >
              {ticket.priority}
            </span>
            <span style={{ fontSize: 13, color: '#6b7280' }}>
              {ticket.organizationName}
            </span>
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#111827', lineHeight: 1.3 }}>
            {ticket.subject}
          </h1>
        </div>

        {/* Resolve button — only shown when transition is available */}
        {ticket.allowedTransitions.includes('resolved') && !isClosed && (
          <button
            ref={resolveButtonRef}
            type="button"
            onClick={() => setResolveOpen(true)}
            style={{
              flexShrink: 0,
              fontSize: 13,
              fontWeight: 700,
              padding: '8px 18px',
              borderRadius: 6,
              border: 'none',
              background: '#16a34a',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            ✓ Resolve
          </button>
        )}
      </header>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Main content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Conversation thread */}
          <ConversationThread
            comments={allComments}
            hasMore={commentsQuery.hasNextPage ?? false}
            isFetchingMore={commentsQuery.isFetchingNextPage}
            onLoadOlder={() => void commentsQuery.fetchNextPage()}
          />

          {/* Composer — hidden when ticket is closed */}
          {!isClosed && (
            <CommentComposer
              canPostInternal
              isSubmitting={addComment.isPending}
              submitError={composerError}
              onSubmit={handleComment}
              pendingAttachmentIds={pendingAttachIds}
            />
          )}

          {/* Attachments */}
          <AttachmentUploader
            onPresign={handlePresign}
            onFinalize={handleFinalize}
            onAttachmentsReady={setPendingAttachIds}
          />

          {/* Jira */}
          <JiraLinkCard
            jiraLink={ticket.jiraLink}
            jiraIntegrationEnabled={ticket.jiraIntegrationEnabled}
          />
        </div>

        {/* Sidebar */}
        <div
          style={{
            width: 260,
            flexShrink: 0,
            borderLeft: '1px solid #e5e7eb',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: 16,
            overflowY: 'auto',
            background: '#fafafa',
          }}
        >
          <PropertySidebar
            ticket={ticket}
            onUpdate={handleUpdate}
          />

          {ticket.sla && (
            <SlaTimelineCard sla={ticket.sla} isClosed={isClosed} />
          )}
        </div>
      </div>

      {/* ── Resolve modal ─────────────────────────────────────────────── */}
      <ResolveModal
        ticket={ticket}
        isOpen={resolveOpen}
        isSubmitting={resolveTicket.isPending}
        submitError={
          resolveTicket.isError
            ? ((resolveTicket.error as { message?: string })?.message ?? 'Failed to resolve ticket.')
            : null
        }
        onClose={() => setResolveOpen(false)}
        onResolve={handleResolve}
      />
    </main>
  );
}
