import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CsatBanner } from '../../components/shell/CsatBanner';
import { PENDING_SURVEY } from '../fixtures/portalPrincipal.fixtures';

vi.mock('../../lib/store/csatDismissal', () => ({
  isSurveyDismissed: vi.fn(),
  dismissSurvey: vi.fn(),
}));

import { isSurveyDismissed, dismissSurvey } from '../../lib/store/csatDismissal';

describe('CsatBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is hidden before hydration (default dismissed state)', () => {
    vi.mocked(isSurveyDismissed).mockReturnValue(false);
    // Before useEffect fires, dismissed=true so nothing rendered
    const { container } = render(<CsatBanner survey={PENDING_SURVEY} />);
    // Initial render shows nothing (dismissed=true by default)
    expect(container.firstChild).toBeNull();
  });

  it('shows banner after hydration when survey is not dismissed', async () => {
    vi.mocked(isSurveyDismissed).mockReturnValue(false);
    render(<CsatBanner survey={PENDING_SURVEY} />);
    await act(async () => {});
    expect(screen.getByTestId('csat-banner')).toBeTruthy();
  });

  it('does not show banner if already dismissed', async () => {
    vi.mocked(isSurveyDismissed).mockReturnValue(true);
    const { container } = render(<CsatBanner survey={PENDING_SURVEY} />);
    await act(async () => {});
    expect(container.firstChild).toBeNull();
  });

  it('has role=status and aria-live=polite', async () => {
    vi.mocked(isSurveyDismissed).mockReturnValue(false);
    render(<CsatBanner survey={PENDING_SURVEY} />);
    await act(async () => {});
    const banner = screen.getByTestId('csat-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });

  it('dismisses on close button click', async () => {
    vi.mocked(isSurveyDismissed).mockReturnValue(false);
    render(<CsatBanner survey={PENDING_SURVEY} />);
    await act(async () => {});
    const btn = screen.getByTestId('csat-dismiss-btn');
    fireEvent.click(btn);
    expect(dismissSurvey).toHaveBeenCalledWith(PENDING_SURVEY.id);
  });

  it('dismisses on Escape key', async () => {
    vi.mocked(isSurveyDismissed).mockReturnValue(false);
    render(<CsatBanner survey={PENDING_SURVEY} />);
    await act(async () => {});
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dismissSurvey).toHaveBeenCalledWith(PENDING_SURVEY.id);
  });

  it('truncates long ticket subject', async () => {
    vi.mocked(isSurveyDismissed).mockReturnValue(false);
    const longSubject = 'A'.repeat(50);
    render(<CsatBanner survey={{ ...PENDING_SURVEY, ticketSubject: longSubject }} />);
    await act(async () => {});
    const banner = screen.getByTestId('csat-banner');
    expect(banner.textContent).toContain('…');
  });

  it('shows full subject when short enough', async () => {
    vi.mocked(isSurveyDismissed).mockReturnValue(false);
    render(<CsatBanner survey={PENDING_SURVEY} />);
    await act(async () => {});
    expect(screen.getByText((t) => t.includes('Login issues with SSO provider'))).toBeTruthy();
  });
});
