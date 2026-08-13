/**
 * TicketDetailPage SPA tests — WO-090 AC3, AC4, AC7, AC9, AC11, AC13.
 *
 * Tests:
 *   - Loading state
 *   - 404 renders as "not found" (not a permission message) (AC4)
 *   - Ticket metadata, status badge, SLA hint (AC3, AC9)
 *   - Public comments only — no visibility field, no internal fields (AC7)
 *   - Empty-thread edge case: ticket with only internal comments (AC3 edge case)
 *   - Status history timeline (AC9)
 *   - Closed ticket shows message instead of reply composer (AC6)
 *   - Open ticket shows reply composer (AC5, AC9)
 *   - Internal fields never appear in rendered HTML (AC7)
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@opsninja/api-client';
import { TicketDetailPage } from '../../src/features/tickets/TicketDetailPage';
import {
  DETAIL_OPEN,
  DETAIL_CLOSED,
  DETAIL_NO_COMMENTS,
} from '../mocks/portalTickets.fixtures';

// ---------------------------------------------------------------------------
// Mock hooks and dependencies
// ---------------------------------------------------------------------------

vi.mock('../../lib/api/tickets/hooks', () => ({
  usePortalTicketDetail: vi.fn(),
  usePortalAddComment:   vi.fn(() => ({
    mutate:    vi.fn(),
    isPending: false,
    isSuccess: false,
    error:     null,
    reset:     vi.fn(),
  })),
  useAttachmentDownload: vi.fn(() => ({
    data:      undefined,
    isFetching: false,
    isError:   false,
    error:     null,
    refetch:   vi.fn(),
  })),
  portalTicketKeys: {
    detail: (id: string) => ['portalTickets', 'detail', id],
    lists: () => ['portalTickets', 'list'],
  },
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('a', { href, ...rest }, children),
}));

import { usePortalTicketDetail } from '../../lib/api/tickets/hooks';
const mockUsePortalTicketDetail = vi.mocked(usePortalTicketDetail);

function makeQueryResult(overrides: Partial<ReturnType<typeof usePortalTicketDetail>>) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    status: 'success' as const,
    ...overrides,
  } as ReturnType<typeof usePortalTicketDetail>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TicketDetailPage — loading state', () => {
  it('renders loading indicator while fetching', () => {
    mockUsePortalTicketDetail.mockReturnValue(makeQueryResult({ isLoading: true }));
    render(<TicketDetailPage ticketId="ticket-a1-001" />);
    expect(screen.getByTestId('ticket-detail-loading')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('TicketDetailPage — 404 / error state (AC4)', () => {
  it('renders not-found message on 404', () => {
    const err = new ApiError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Ticket not found.',
      details: [],
      traceId: 'test',
    });
    mockUsePortalTicketDetail.mockReturnValue(makeQueryResult({ isError: true, error: err }));
    render(<TicketDetailPage ticketId="ticket-a2-001" />);
    const el = screen.getByTestId('ticket-detail-error');
    // Must say "not found" — never "permission denied" (AC4)
    expect(el.textContent).toMatch(/not found/i);
    expect(el.textContent).not.toMatch(/permission|forbidden|access denied/i);
  });

  it('renders generic error on server failure', () => {
    mockUsePortalTicketDetail.mockReturnValue(
      makeQueryResult({ isError: true, error: new Error('Server error') }),
    );
    render(<TicketDetailPage ticketId="ticket-a1-001" />);
    const el = screen.getByTestId('ticket-detail-error');
    expect(el.textContent).toContain('Server error');
  });

  it('error element has role=alert', () => {
    mockUsePortalTicketDetail.mockReturnValue(
      makeQueryResult({ isError: true, error: new Error('fail') }),
    );
    render(<TicketDetailPage ticketId="ticket-a1-001" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('TicketDetailPage — ticket metadata (AC3, AC9)', () => {
  beforeEach(() => {
    mockUsePortalTicketDetail.mockReturnValue(makeQueryResult({ data: DETAIL_OPEN }));
  });

  it('renders ticket subject', () => {
    render(<TicketDetailPage ticketId={DETAIL_OPEN.id} />);
    expect(screen.getByTestId('ticket-subject').textContent).toBe(DETAIL_OPEN.subject);
  });

  it('renders StatusBadge with correct status', () => {
    render(<TicketDetailPage ticketId={DETAIL_OPEN.id} />);
    expect(document.querySelector('[data-status="open"]')).not.toBeNull();
  });

  it('renders SlaHint with SLA state', () => {
    render(<TicketDetailPage ticketId={DETAIL_OPEN.id} />);
    expect(document.querySelector('[data-sla-state="running"]')).not.toBeNull();
  });
});

describe('TicketDetailPage — conversation thread (AC3, AC7)', () => {
  it('renders all public comments', () => {
    mockUsePortalTicketDetail.mockReturnValue(makeQueryResult({ data: DETAIL_OPEN }));
    render(<TicketDetailPage ticketId={DETAIL_OPEN.id} />);
    for (const comment of DETAIL_OPEN.comments) {
      expect(screen.getByTestId(`comment-${comment.id}`)).toBeInTheDocument();
    }
  });

  it('renders comment body text', () => {
    mockUsePortalTicketDetail.mockReturnValue(makeQueryResult({ data: DETAIL_OPEN }));
    render(<TicketDetailPage ticketId={DETAIL_OPEN.id} />);
    expect(screen.getByText(DETAIL_OPEN.comments[0]!.body)).toBeInTheDocument();
  });

  it('renders authorDisplayName and authorType (AC7 — no PII)', () => {
    mockUsePortalTicketDetail.mockReturnValue(makeQueryResult({ data: DETAIL_OPEN }));
    render(<TicketDetailPage ticketId={DETAIL_OPEN.id} />);
    expect(screen.getByText('Customer')).toBeInTheDocument();
    expect(screen.getByText('Support Agent')).toBeInTheDocument();
  });

  it('empty thread renders helpful message (edge case AC3)', () => {
    mockUsePortalTicketDetail.mockReturnValue(makeQueryResult({ data: DETAIL_NO_COMMENTS }));
    render(<TicketDetailPage ticketId={DETAIL_NO_COMMENTS.id} />);
    expect(screen.getByTestId('no-comments')).toBeInTheDocument();
  });

  it('does NOT expose visibility field in rendered HTML (AC7)', () => {
    mockUsePortalTicketDetail.mockReturnValue(makeQueryResult({ data: DETAIL_OPEN }));
    render(<TicketDetailPage ticketId={DETAIL_OPEN.id} />);
    const html = document.body.innerHTML;
    expect(html).not.toContain('"visibility"');
    expect(html).not.toContain('"internal"');
  });
});

describe('TicketDetailPage — internal field exclusion (AC7)', () => {
  it('does not render internal fields in HTML', () => {
    mockUsePortalTicketDetail.mockReturnValue(makeQueryResult({ data: DETAIL_OPEN }));
    render(<TicketDetailPage ticketId={DETAIL_OPEN.id} />);
    const html = document.body.innerHTML;
    expect(html).not.toContain('assigneeId');
    expect(html).not.toContain('affectedAreaTags');
    expect(html).not.toContain('aiStatus');
    expect(html).not.toContain('s3Key');
    expect(html).not.toContain('pausedMs');
    expect(html).not.toContain('elapsedMs');
    expect(html).not.toContain('thresholds');
  });
});

describe('TicketDetailPage — closed ticket (AC6)', () => {
  it('shows closed message instead of reply composer for closed tickets', () => {
    mockUsePortalTicketDetail.mockReturnValue(makeQueryResult({ data: DETAIL_CLOSED }));
    render(<TicketDetailPage ticketId={DETAIL_CLOSED.id} />);
    // Should see closed state message, not the reply composer
    expect(document.querySelector('[data-testid="reply-composer"]')).toBeNull();
    expect(screen.getByText(/closed/i)).toBeInTheDocument();
  });
});

describe('TicketDetailPage — open ticket reply composer (AC5, AC9)', () => {
  it('shows reply composer for open tickets', () => {
    mockUsePortalTicketDetail.mockReturnValue(makeQueryResult({ data: DETAIL_OPEN }));
    render(<TicketDetailPage ticketId={DETAIL_OPEN.id} />);
    expect(screen.getByTestId('reply-composer')).toBeInTheDocument();
  });
});

describe('TicketDetailPage — status history (AC9)', () => {
  it('renders status history toggle button', () => {
    mockUsePortalTicketDetail.mockReturnValue(makeQueryResult({ data: DETAIL_OPEN }));
    render(<TicketDetailPage ticketId={DETAIL_OPEN.id} />);
    expect(screen.getByTestId('toggle-history')).toBeInTheDocument();
  });

  it('actor identity (actorUserId) is never rendered (AC7)', () => {
    mockUsePortalTicketDetail.mockReturnValue(makeQueryResult({ data: DETAIL_OPEN }));
    render(<TicketDetailPage ticketId={DETAIL_OPEN.id} />);
    const html = document.body.innerHTML;
    expect(html).not.toContain('actorUserId');
  });
});
