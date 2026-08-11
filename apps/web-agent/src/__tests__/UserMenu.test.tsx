import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserMenu } from '@/components/shell/UserMenu';
import { agentPrincipal } from '../fixtures/identity.fixtures';

vi.mock('@/lib/identity/useIdentity', () => ({
  useCurrentPrincipal: vi.fn(),
  useOrgScope: vi.fn(() => ({ data: null, isLoading: false, isError: false })),
}));

import { useCurrentPrincipal } from '@/lib/identity/useIdentity';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('UserMenu', () => {
  it('shows skeleton while loading', () => {
    vi.mocked(useCurrentPrincipal).mockReturnValue({ data: undefined, isLoading: true, isError: false } as ReturnType<typeof useCurrentPrincipal>);
    wrap(<UserMenu />);
    expect(screen.getByTestId('user-menu-skeleton')).toBeInTheDocument();
  });

  it('shows error state on failure', () => {
    vi.mocked(useCurrentPrincipal).mockReturnValue({ data: undefined, isLoading: false, isError: true } as ReturnType<typeof useCurrentPrincipal>);
    wrap(<UserMenu />);
    expect(screen.getByTestId('user-menu-error')).toBeInTheDocument();
  });

  it('opens dropdown on button click', () => {
    vi.mocked(useCurrentPrincipal).mockReturnValue({ data: agentPrincipal, isLoading: false, isError: false } as ReturnType<typeof useCurrentPrincipal>);
    wrap(<UserMenu />);
    fireEvent.click(screen.getByTestId('user-menu-button'));
    expect(screen.getByTestId('user-menu-dropdown')).toBeInTheDocument();
  });

  it('shows name, email, and role in dropdown', () => {
    vi.mocked(useCurrentPrincipal).mockReturnValue({ data: agentPrincipal, isLoading: false, isError: false } as ReturnType<typeof useCurrentPrincipal>);
    wrap(<UserMenu />);
    fireEvent.click(screen.getByTestId('user-menu-button'));
    expect(screen.getByTestId('user-menu-name')).toHaveTextContent('Sam Agent');
    expect(screen.getByTestId('user-menu-email')).toHaveTextContent('sam.agent@opsninja.io');
    expect(screen.getByTestId('user-menu-role')).toHaveTextContent('agent');
  });

  it('renders sign-out action', () => {
    vi.mocked(useCurrentPrincipal).mockReturnValue({ data: agentPrincipal, isLoading: false, isError: false } as ReturnType<typeof useCurrentPrincipal>);
    wrap(<UserMenu />);
    fireEvent.click(screen.getByTestId('user-menu-button'));
    expect(screen.getByTestId('user-menu-sign-out')).toBeInTheDocument();
  });

  it('calls sign-out endpoint on click', async () => {
    vi.mocked(useCurrentPrincipal).mockReturnValue({ data: agentPrincipal, isLoading: false, isError: false } as ReturnType<typeof useCurrentPrincipal>);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    // Mock location change
    Object.defineProperty(window, 'location', { value: { href: '/' }, writable: true });

    wrap(<UserMenu />);
    fireEvent.click(screen.getByTestId('user-menu-button'));
    fireEvent.click(screen.getByTestId('user-menu-sign-out'));

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/v1/auth/logout', expect.objectContaining({ method: 'POST' }));
    });
    fetchSpy.mockRestore();
  });
});
