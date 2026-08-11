import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PortalTabs } from '../../components/shell/PortalTabs';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) =>
    React.createElement('a', { href, ...props }, children),
}));

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}));

import { usePathname } from 'next/navigation';

describe('PortalTabs', () => {
  it('renders all three tabs', () => {
    vi.mocked(usePathname).mockReturnValue('/tickets');
    render(<PortalTabs />);
    expect(screen.getByText('My Tickets')).toBeTruthy();
    expect(screen.getByText('Submit Request')).toBeTruthy();
    expect(screen.getByText('Knowledge')).toBeTruthy();
  });

  it('sets aria-current=page on active tab', () => {
    vi.mocked(usePathname).mockReturnValue('/tickets');
    render(<PortalTabs />);
    const activeLink = screen.getByText('My Tickets').closest('a');
    expect(activeLink?.getAttribute('aria-current')).toBe('page');
  });

  it('does not set aria-current on inactive tabs', () => {
    vi.mocked(usePathname).mockReturnValue('/tickets');
    render(<PortalTabs />);
    const submitLink = screen.getByText('Submit Request').closest('a');
    expect(submitLink?.getAttribute('aria-current')).toBeNull();
  });

  it('marks submit tab active when on /submit', () => {
    vi.mocked(usePathname).mockReturnValue('/submit');
    render(<PortalTabs />);
    const submitLink = screen.getByText('Submit Request').closest('a');
    expect(submitLink?.getAttribute('aria-current')).toBe('page');
  });

  it('marks knowledge tab active on nested path', () => {
    vi.mocked(usePathname).mockReturnValue('/knowledge/article-123');
    render(<PortalTabs />);
    const knowledgeLink = screen.getByText('Knowledge').closest('a');
    expect(knowledgeLink?.getAttribute('aria-current')).toBe('page');
  });

  it('has portal navigation landmark', () => {
    vi.mocked(usePathname).mockReturnValue('/tickets');
    render(<PortalTabs />);
    expect(screen.getByRole('navigation', { name: 'Portal navigation' })).toBeTruthy();
  });

  it('applies data-portal-tab attribute', () => {
    vi.mocked(usePathname).mockReturnValue('/tickets');
    render(<PortalTabs />);
    const link = screen.getByText('My Tickets').closest('a');
    expect(link?.getAttribute('data-portal-tab')).toBe('my-tickets');
  });
});
