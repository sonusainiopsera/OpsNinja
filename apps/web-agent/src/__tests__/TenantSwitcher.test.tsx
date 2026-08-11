import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TenantSwitcher } from '@/components/shell/TenantSwitcher';
import { singleOrgScope, multiOrgScope } from '../fixtures/identity.fixtures';

// Mock useOrgScope
vi.mock('@/lib/identity/useIdentity', () => ({
  useOrgScope: vi.fn(),
  useCurrentPrincipal: vi.fn(() => ({ data: null, isLoading: false, isError: false })),
}));

import { useOrgScope } from '@/lib/identity/useIdentity';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('TenantSwitcher', () => {
  it('shows skeleton while loading', () => {
    vi.mocked(useOrgScope).mockReturnValue({ data: undefined, isLoading: true, isError: false } as ReturnType<typeof useOrgScope>);
    wrap(<TenantSwitcher />);
    expect(screen.getByTestId('tenant-switcher-skeleton')).toBeInTheDocument();
  });

  it('shows error state on failure', () => {
    vi.mocked(useOrgScope).mockReturnValue({ data: undefined, isLoading: false, isError: true } as ReturnType<typeof useOrgScope>);
    wrap(<TenantSwitcher />);
    expect(screen.getByTestId('tenant-switcher-error')).toBeInTheDocument();
  });

  it('renders static indicator for single-org principal', () => {
    vi.mocked(useOrgScope).mockReturnValue({ data: singleOrgScope, isLoading: false, isError: false } as ReturnType<typeof useOrgScope>);
    wrap(<TenantSwitcher />);
    const switcher = screen.getByTestId('tenant-switcher');
    expect(switcher).toHaveAttribute('data-single-org', 'true');
    expect(switcher).toHaveTextContent('Acme Corp');
    // No interactive picker
    expect(switcher.querySelector('button')).not.toBeInTheDocument();
  });

  it('renders searchable dropdown for multi-org principal', () => {
    vi.mocked(useOrgScope).mockReturnValue({ data: multiOrgScope, isLoading: false, isError: false } as ReturnType<typeof useOrgScope>);
    wrap(<TenantSwitcher />);
    const switcher = screen.getByTestId('tenant-switcher');
    expect(switcher).toHaveAttribute('data-multi-org', 'true');
    expect(switcher.querySelector('button')).toBeInTheDocument();
  });

  it('opens dropdown and shows org list on click', () => {
    vi.mocked(useOrgScope).mockReturnValue({ data: multiOrgScope, isLoading: false, isError: false } as ReturnType<typeof useOrgScope>);
    wrap(<TenantSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: /Organization/ }));
    expect(screen.getByRole('dialog', { name: 'Switch organization' })).toBeInTheDocument();
    expect(screen.getByText('Beta Systems')).toBeInTheDocument();
  });

  it('filters org list on search input', () => {
    vi.mocked(useOrgScope).mockReturnValue({ data: multiOrgScope, isLoading: false, isError: false } as ReturnType<typeof useOrgScope>);
    wrap(<TenantSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: /Organization/ }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'beta' } });
    expect(screen.getByText('Beta Systems')).toBeInTheDocument();
    expect(screen.queryByText('Gamma Industries')).not.toBeInTheDocument();
  });

  it('shows no results message when search returns nothing', () => {
    vi.mocked(useOrgScope).mockReturnValue({ data: multiOrgScope, isLoading: false, isError: false } as ReturnType<typeof useOrgScope>);
    wrap(<TenantSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: /Organization/ }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('renders org initials in collapsed mode', () => {
    vi.mocked(useOrgScope).mockReturnValue({ data: singleOrgScope, isLoading: false, isError: false } as ReturnType<typeof useOrgScope>);
    wrap(<TenantSwitcher collapsed />);
    expect(screen.getByTestId('tenant-switcher')).toHaveTextContent('AC');
  });
});
