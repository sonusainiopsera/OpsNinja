import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PortalTabs } from '../../components/shell/PortalTabs';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/tickets'),
}));

import { usePathname } from 'next/navigation';
const mockUsePathname = vi.mocked(usePathname);

describe('PortalTabs', () => {
  it('renders all three tabs', () => {
    render(<PortalTabs />);
    expect(screen.getByTestId('portal-tab-my-tickets')).toBeInTheDocument();
    expect(screen.getByTestId('portal-tab-submit-request')).toBeInTheDocument();
    expect(screen.getByTestId('portal-tab-knowledge')).toBeInTheDocument();
  });

  it('marks the active tab with aria-current=page', () => {
    mockUsePathname.mockReturnValue('/tickets');
    render(<PortalTabs />);
    const activeTab = screen.getByTestId('portal-tab-my-tickets');
    expect(activeTab.getAttribute('aria-current')).toBe('page');
  });

  it('sets aria-selected=true on active tab', () => {
    mockUsePathname.mockReturnValue('/tickets');
    render(<PortalTabs />);
    expect(screen.getByTestId('portal-tab-my-tickets').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('portal-tab-submit-request').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('portal-tab-knowledge').getAttribute('aria-selected')).toBe('false');
  });

  it('activates submit request tab when on /submit', () => {
    mockUsePathname.mockReturnValue('/submit');
    render(<PortalTabs />);
    expect(screen.getByTestId('portal-tab-submit-request').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('portal-tab-my-tickets').getAttribute('aria-current')).toBeNull();
  });

  it('activates knowledge tab when on /knowledge', () => {
    mockUsePathname.mockReturnValue('/knowledge');
    render(<PortalTabs />);
    expect(screen.getByTestId('portal-tab-knowledge').getAttribute('aria-current')).toBe('page');
  });

  it('activates my-tickets for nested route /tickets/123', () => {
    mockUsePathname.mockReturnValue('/tickets/123');
    render(<PortalTabs />);
    expect(screen.getByTestId('portal-tab-my-tickets').getAttribute('aria-current')).toBe('page');
  });

  it('does not activate /tickets tab for /ticketsomething (segment boundary)', () => {
    mockUsePathname.mockReturnValue('/ticketsomething');
    render(<PortalTabs />);
    expect(screen.getByTestId('portal-tab-my-tickets').getAttribute('aria-current')).toBeNull();
  });

  it('renders in a nav landmark with aria-label', () => {
    render(<PortalTabs />);
    const nav = screen.getByRole('navigation', { name: /portal navigation/i });
    expect(nav).toBeInTheDocument();
  });

  it('renders tabs as links', () => {
    mockUsePathname.mockReturnValue('/tickets');
    render(<PortalTabs />);
    const ticketsTab = screen.getByTestId('portal-tab-my-tickets') as HTMLAnchorElement;
    expect(ticketsTab.tagName).toBe('A');
    expect(ticketsTab.href).toContain('/tickets');
  });
});
