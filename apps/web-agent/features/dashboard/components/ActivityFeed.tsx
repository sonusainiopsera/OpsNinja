'use client';

/**
 * ActivityFeed — live activity feed (WO-070, AC1, AC10).
 *
 * Renders activity events from the dashboard stream, newest first.
 * Capped at 100 entries (enforced by applyDelta; the component renders
 * whatever it receives).
 *
 * Only non-PII fields are rendered: eventType, ticketKey, priority,
 * organizationName, actorRole, occurredAt. actorId/userId are never shown.
 *
 * Accessibility: the feed region uses aria-label and each row has an
 * accessible description (not colour-only priority indicator).
 */

import React from 'react';
import type { ActivityFeedRow } from '../../../lib/api/dashboard';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ActivityFeedProps {
  events: ActivityFeedRow[];
  loading?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// EventRow
// ---------------------------------------------------------------------------

interface EventRowProps {
  event: ActivityFeedRow;
}

function EventRow({ event }: EventRowProps) {
  const timeLabel = formatRelativeTime(event.occurredAt);
  const eventLabel = formatEventType(event.eventType);

  return (
    <li
      data-testid="feed-event-row"
      data-event-type={event.eventType}
      aria-label={`${eventLabel} — ${event.ticketKey}, ${event.organizationId}, ${timeLabel}`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '8px 0',
        borderBottom: '1px solid var(--color-border, #e5e7eb)',
      }}
    >
      {/* Priority indicator: colour + text label (not colour alone) */}
      <span
        aria-label={`Priority ${event.priority}`}
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          background:
            event.priority === 'P1'
              ? 'var(--priority-p1-bg, #fee2e2)'
              : event.priority === 'P2'
                ? 'var(--priority-p2-bg, #fef3c7)'
                : 'var(--color-bg-muted, #f3f4f6)',
          color:
            event.priority === 'P1'
              ? 'var(--priority-p1-fg, #991b1b)'
              : event.priority === 'P2'
                ? 'var(--priority-p2-fg, #92400e)'
                : 'var(--color-fg-secondary, #6b7280)',
        }}
      >
        {event.priority}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--color-fg-primary, #111827)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 12,
              color: 'var(--color-fg-secondary, #6b7280)',
            }}
          >
            {event.ticketKey}
          </span>
          <span style={{ color: 'var(--color-fg-tertiary, #9ca3af)' }}>·</span>
          <span>{eventLabel}</span>
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-fg-tertiary, #9ca3af)',
            marginTop: 2,
            display: 'flex',
            gap: 8,
          }}
        >
          {/* actorRole shown — never actorId or email */}
          <span>{event.actorRole}</span>
          <span>·</span>
          <time dateTime={event.occurredAt}>{timeLabel}</time>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// ActivityFeed
// ---------------------------------------------------------------------------

export function ActivityFeed({ events, loading = false, className }: ActivityFeedProps) {
  if (loading) {
    return (
      <section
        className={className}
        aria-label="Activity feed"
        aria-busy="true"
        data-testid="activity-feed"
      >
        <p
          style={{
            fontSize: 13,
            color: 'var(--color-fg-tertiary, #9ca3af)',
            padding: '20px 0',
            textAlign: 'center',
          }}
        >
          Loading…
        </p>
      </section>
    );
  }

  if (events.length === 0) {
    return (
      <section
        className={className}
        aria-label="Activity feed: no recent activity"
        data-testid="activity-feed"
        data-empty="true"
      >
        <p
          style={{
            fontSize: 13,
            color: 'var(--color-fg-tertiary, #9ca3af)',
            padding: '20px 0',
            textAlign: 'center',
          }}
        >
          No recent activity
        </p>
      </section>
    );
  }

  return (
    <section
      className={className}
      aria-label={`Activity feed — ${events.length} event${events.length !== 1 ? 's' : ''}`}
      data-testid="activity-feed"
    >
      <ul
        aria-live="polite"
        aria-relevant="additions"
        style={{ listStyle: 'none', margin: 0, padding: 0 }}
      >
        {events.map((event, idx) => (
          <EventRow key={`${event.ticketId}-${event.occurredAt}-${idx}`} event={event} />
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEventType(type: string): string {
  const map: Record<string, string> = {
    'ticket.created': 'Ticket created',
    'ticket.updated': 'Ticket updated',
    'ticket.resolved': 'Ticket resolved',
    'ticket.closed': 'Ticket closed',
    'comment.created': 'Comment added',
    'attachment.uploaded': 'Attachment uploaded',
    'sla.warning': 'SLA warning',
    'sla.breached': 'SLA breached',
    'ticket.assigned': 'Ticket assigned',
    'jira.linked': 'Jira linked',
  };
  return map[type] ?? type.replace(/[._]/g, ' ');
}

function formatRelativeTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) return 'just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  } catch {
    return isoString;
  }
}
