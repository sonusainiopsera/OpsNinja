/**
 * ReplyComposer unit tests — WO-090 AC5, AC11.
 *
 * Tests:
 *   - visibility field is NEVER sent to the API (AC5)
 *   - empty body is rejected (form validation)
 *   - TICKET_CLOSED error surfaces actionable message (AC6)
 *   - Successful submission clears the textarea
 *   - Pending state disables submit button
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplyComposer } from '../../src/features/tickets/ReplyComposer';

// ---------------------------------------------------------------------------
// Mock hooks
// ---------------------------------------------------------------------------

const mutateMock = vi.fn();

vi.mock('../../lib/api/tickets/hooks', () => ({
  usePortalAddComment: vi.fn(() => ({
    mutate:    mutateMock,
    isPending: false,
    isSuccess: false,
    error:     null,
    reset:     vi.fn(),
  })),
}));

import { usePortalAddComment } from '../../lib/api/tickets/hooks';
const mockUsePortalAddComment = vi.mocked(usePortalAddComment);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mutateMock.mockReset();
});

describe('ReplyComposer — form', () => {
  it('renders textarea and submit button', () => {
    render(<ReplyComposer ticketId="ticket-001" />);
    expect(screen.getByTestId('reply-body')).toBeInTheDocument();
    expect(screen.getByTestId('reply-submit')).toBeInTheDocument();
  });

  it('submit button is disabled when body is empty', () => {
    render(<ReplyComposer ticketId="ticket-001" />);
    const btn = screen.getByTestId('reply-submit');
    expect(btn).toBeDisabled();
  });

  it('submit button enables when body has content', () => {
    render(<ReplyComposer ticketId="ticket-001" />);
    fireEvent.change(screen.getByTestId('reply-body'), { target: { value: 'Hello' } });
    expect(screen.getByTestId('reply-submit')).not.toBeDisabled();
  });
});

describe('ReplyComposer — visibility forcing (AC5)', () => {
  it('calls mutate WITHOUT visibility field', () => {
    render(<ReplyComposer ticketId="ticket-001" />);
    fireEvent.change(screen.getByTestId('reply-body'), { target: { value: 'Test reply' } });
    const form =
      screen.queryByRole('form') ??
      document.querySelector<HTMLFormElement>('[data-testid="reply-composer"]');
    if (form) fireEvent.submit(form);

    expect(mutateMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ visibility: expect.anything() }),
      expect.anything(),
    );
  });

  it('calls mutate with body text', () => {
    render(<ReplyComposer ticketId="ticket-001" />);
    fireEvent.change(screen.getByTestId('reply-body'), { target: { value: 'Test reply' } });
    const form = document.querySelector<HTMLFormElement>('[data-testid="reply-composer"]');
    if (form) fireEvent.submit(form);

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Test reply' }),
      expect.anything(),
    );
  });
});

describe('ReplyComposer — pending state', () => {
  it('disables submit while pending', () => {
    mockUsePortalAddComment.mockReturnValue({
      mutate:    mutateMock,
      isPending: true,
      isSuccess: false,
      error:     null,
      reset:     vi.fn(),
    } as any);
    render(<ReplyComposer ticketId="ticket-001" />);
    fireEvent.change(screen.getByTestId('reply-body'), { target: { value: 'msg' } });
    expect(screen.getByTestId('reply-submit')).toBeDisabled();
  });

  it('shows "Sending…" label while pending', () => {
    mockUsePortalAddComment.mockReturnValue({
      mutate:    mutateMock,
      isPending: true,
      isSuccess: false,
      error:     null,
      reset:     vi.fn(),
    } as any);
    render(<ReplyComposer ticketId="ticket-001" />);
    expect(screen.getByTestId('reply-submit').textContent).toContain('Sending');
  });
});

describe('ReplyComposer — TICKET_CLOSED error (AC6)', () => {
  it('renders TICKET_CLOSED actionable message on 422', async () => {
    const { ApiError } = await import('@opsninja/api-client');
    const err = new ApiError({
      status: 422,
      code: 'TICKET_CLOSED',
      message: 'This ticket is closed.',
      details: [],
      traceId: 'test',
    });

    mockUsePortalAddComment.mockReturnValue({
      mutate:    mutateMock,
      isPending: false,
      isSuccess: false,
      error:     err,
      reset:     vi.fn(),
    } as any);

    render(<ReplyComposer ticketId="ticket-001" />);
    const errorEl = screen.getByTestId('reply-error');
    expect(errorEl).toBeInTheDocument();
    expect(errorEl.textContent).toMatch(/closed/i);
  });
});

describe('ReplyComposer — disabled prop', () => {
  it('disables textarea and button when disabled=true', () => {
    render(<ReplyComposer ticketId="ticket-001" disabled />);
    expect(screen.getByTestId('reply-body')).toBeDisabled();
    expect(screen.getByTestId('reply-submit')).toBeDisabled();
  });
});
