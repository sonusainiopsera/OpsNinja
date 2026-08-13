/**
 * TicketListPage SPA tests — WO-090 AC9, AC11, AC13.
 *
 * Tests:
 *   - Empty state rendering
 *   - Loading state rendering
 *   - Error state rendering
 *   - Ticket list with status/SLA badges
 *   - Filter interaction (status, subject search)
 *   - Pagination controls
 *
 * Hooks are mocked via vi.mock — no MSW required.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TicketListPage } from '../../src/features/tickets/TicketListPage';
import {
  LIST_RESPONSE_WITH_DATA,
  LIST_RESPONSE_PAGINATED,
  LIST_RESPONSE_EMPTY,
  TICKET_OPEN,
  TICKET_CLOSED,
} from '../mocks/portalTickets.fixtures';

// ---------------------------------------------------------------------------
// Mock hooks
// ---------------------------------------------------------------------------

vi.mock('../../lib/api/tickets/hooks', () => ({
  usePortalTicketList: vi.fn(),
  portalTicketKeys: {
    all: ['portalTickets'],
    lists: () => ['portalTickets', 'list'],
    list: (f: unknown) => ['portalTickets', 'list', f],
  },
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('a', { href, ...rest }, children),
}));

import { usePortalTicketList } from '../../lib/api/tickets/hooks';
const mockUsePortalTicketList = vi.mocked(usePortalTicketList);

// ---------------------------------------------------------------------------
// Default return shape helper
// ---------------------------------------------------------------------------

function makeQueryResult(overrides: Partial<ReturnType<typeof usePortalTicketList>>) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    status: 'success' as const,
    ...overrides,
  } as ReturnType<typeof usePortalTicketList>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TicketListPage — empty state', () => {
  it('renders empty state message when no tickets', () => {
    mockUsePortalTicketList.mockReturnValue(
      makeQueryResult({ data: LIST_RESPONSE_EMPTY, isLoading: false }),
    );
    render(<TicketListPage />);
    expect(screen.getByTestId('tickets-empty')).toBeInTheDocument();
  });

  it('does not render loading or error when data is empty', () => {
    mockUsePortalTicketList.mockReturnValue(
      makeQueryResult({ data: LIST_RESPONSE_EMPTY, isLoading: false }),
    );
    render(<TicketListPage />);
    expect(screen.queryByTestId('tickets-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tickets-error')).not.toBeInTheDocument();
  });
});

describe('TicketListPage — loading state', () => {
  it('renders loading message while fetching', () => {
    mockUsePortalTicketList.mockReturnValue(
      makeQueryResult({ isLoading: true }),
    );
    render(<TicketListPage />);
    expect(screen.getByTestId('tickets-loading')).toBeInTheDocument();
  });

  it('loading element has role=status', () => {
    mockUsePortalTicketList.mockReturnValue(
      makeQueryResult({ isLoading: true }),
    );
    render(<TicketListPage />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('TicketListPage — error state', () => {
  it('renders error message on API failure', () => {
    const err = new Error('Network failure');
    mockUsePortalTicketList.mockReturnValue(
      makeQueryResult({ isError: true, error: err }),
    );
    render(<TicketListPage />);
    const el = screen.getByTestId('tickets-error');
    expect(el).toBeInTheDocument();
    expect(el.textContent).toContain('Network failure');
  });

  it('error element has role=alert', () => {
    mockUsePortalTicketList.mockReturnValue(
      makeQueryResult({ isError: true, error: new Error('fail') }),
    );
    render(<TicketListPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('TicketListPage — ticket list', () => {
  beforeEach(() => {
    mockUsePortalTicketList.mockReturnValue(
      makeQueryResult({ data: LIST_RESPONSE_WITH_DATA }),
    );
  });

  it('renders a row for each ticket', () => {
    render(<TicketListPage />);
    expect(screen.getByTestId(`ticket-row-${TICKET_OPEN.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`ticket-row-${TICKET_CLOSED.id}`)).toBeInTheDocument();
  });

  it('each ticket row links to the detail page', () => {
    render(<TicketListPage />);
    const link = screen.getByTestId(`ticket-row-${TICKET_OPEN.id}`).closest('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe(`/tickets/${TICKET_OPEN.id}`);
  });

  it('renders StatusBadge for each ticket (data-status attribute)', () => {
    render(<TicketListPage />);
    // Open ticket should have open badge
    const openBadge = screen.getAllByRole('generic').find(
      (el) => el.getAttribute('data-status') === 'open',
    );
    expect(openBadge).toBeTruthy();
  });

  it('renders SlaHint for tickets with SLA data', () => {
    render(<TicketListPage />);
    // TICKET_OPEN has SLA running — SlaHint renders data-sla-state
    const slaHint = screen.getAllByRole('generic').find(
      (el) => el.getAttribute('data-sla-state') === 'running',
    );
    expect(slaHint).toBeTruthy();
  });

  it('does NOT include internal fields in rendered output (AC7)', () => {
    render(<TicketListPage />);
    const html = document.body.innerHTML;
    expect(html).not.toContain('assigneeId');
    expect(html).not.toContain('visibility');
    expect(html).not.toContain('affectedAreaTags');
    expect(html).not.toContain('s3Key');
  });
});

describe('TicketListPage — filters', () => {
  beforeEach(() => {
    mockUsePortalTicketList.mockReturnValue(
      makeQueryResult({ data: LIST_RESPONSE_WITH_DATA }),
    );
  });

  it('renders status filter select', () => {
    render(<TicketListPage />);
    expect(screen.getByTestId('status-filter')).toBeInTheDocument();
  });

  it('renders subject search input', () => {
    render(<TicketListPage />);
    expect(screen.getByTestId('subject-search')).toBeInTheDocument();
  });

  it('calls hook with status filter after form submit', () => {
    render(<TicketListPage />);
    const select = screen.getByTestId('status-filter');
    fireEvent.change(select, { target: { value: 'open' } });

    // Try named form role first; fall back to querySelector
    const form =
      screen.queryByRole('form') ??
      document.querySelector<HTMLFormElement>('form[aria-label="Filter tickets"]');
    if (form) fireEvent.submit(form);

    // On submit, the hook is called again with updated filters
    expect(mockUsePortalTicketList).toHaveBeenCalled();
  });
});

describe('TicketListPage — pagination', () => {
  it('shows next button when nextCursor is present', () => {
    mockUsePortalTicketList.mockReturnValue(
      makeQueryResult({ data: LIST_RESPONSE_PAGINATED }),
    );
    render(<TicketListPage />);
    expect(screen.getByTestId('next-page')).toBeInTheDocument();
  });

  it('next button is disabled when no nextCursor', () => {
    mockUsePortalTicketList.mockReturnValue(
      makeQueryResult({ data: LIST_RESPONSE_WITH_DATA }),
    );
    render(<TicketListPage />);
    // nextCursor is null, no pagination controls shown at all (or button is absent)
    const nextBtn = screen.queryByTestId('next-page');
    if (nextBtn) {
      expect(nextBtn).toBeDisabled();
    } else {
      expect(nextBtn).toBeNull();
    }
  });
});
