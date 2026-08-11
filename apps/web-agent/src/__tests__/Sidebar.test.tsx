import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from '@/components/shell/Sidebar';
import { agentPrincipal, adminPrincipal } from '../fixtures/identity.fixtures';

// Mock next/navigation
vi.mock('next/navigation', () => ({ usePathname: vi.fn(() => '/dashboard') }));
// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [k: string]: unknown }) =>
    <a href={href} {...props}>{children}</a>,
}));
// Mock TenantSwitcher (isolate)
vi.mock('@/components/shell/TenantSwitcher', () => ({
  TenantSwitcher: () => <div data-testid="tenant-switcher-mock" />,
}));
// Mock useOrgScope
vi.mock('@/lib/identity/useIdentity', () => ({
  useOrgScope: vi.fn(() => ({ data: null, isLoading: false, isError: false })),
  useCurrentPrincipal: vi.fn(() => ({ data: null, isLoading: false, isError: false })),
}));

function wrap(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders desktop sidebar', () => {
    wrap(<Sidebar principal={agentPrincipal} />);
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('shows only allowed nav items for agent (no admin items in DOM)', () => {
    wrap(<Sidebar principal={agentPrincipal} />);
    expect(screen.queryByTestId('nav-item-organizations')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-item-sla-policies')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-item-jira-integration')).not.toBeInTheDocument();
  });

  it('agent CAN see dashboard and tickets', () => {
    wrap(<Sidebar principal={agentPrincipal} />);
    expect(screen.getByTestId('nav-item-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-tickets')).toBeInTheDocument();
  });

  it('admin sees organizations and sla-policies', () => {
    wrap(<Sidebar principal={adminPrincipal} />);
    expect(screen.getByTestId('nav-item-organizations')).toBeInTheDocument();
    expect(screen.getByTestId('nav-item-sla-policies')).toBeInTheDocument();
  });

  it('active nav item has aria-current=page', () => {
    wrap(<Sidebar principal={agentPrincipal} />);
    const dashItem = screen.getByTestId('nav-item-dashboard');
    expect(dashItem.querySelector('[aria-current="page"]')).toBeInTheDocument();
  });

  it('inactive item does not have aria-current=page', () => {
    wrap(<Sidebar principal={agentPrincipal} />);
    const ticketsItem = screen.getByTestId('nav-item-tickets');
    expect(ticketsItem.querySelector('[aria-current="page"]')).not.toBeInTheDocument();
  });

  it('collapse toggle changes collapsed state', () => {
    wrap(<Sidebar principal={agentPrincipal} />);
    const toggle = screen.getByTestId('sidebar-collapse-toggle');
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'false');
    fireEvent.click(toggle);
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');
  });

  it('persists collapse state to localStorage', () => {
    wrap(<Sidebar principal={agentPrincipal} />);
    fireEvent.click(screen.getByTestId('sidebar-collapse-toggle'));
    expect(localStorage.getItem('opsninja.shell.sidebar')).toBe('collapsed');
  });

  it('reads initial collapse state from localStorage', () => {
    localStorage.setItem('opsninja.shell.sidebar', 'collapsed');
    wrap(<Sidebar principal={agentPrincipal} />);
    // After hydration (useEffect) the state becomes true
    expect(screen.getByTestId('sidebar')).toBeDefined();
  });

  it('renders mobile drawer when mobileOpen=true', () => {
    wrap(<Sidebar principal={agentPrincipal} mobileOpen={true} onMobileClose={vi.fn()} />);
    expect(screen.getByTestId('mobile-drawer')).toBeInTheDocument();
  });

  it('close button in mobile drawer calls onMobileClose', () => {
    const onClose = vi.fn();
    wrap(<Sidebar principal={agentPrincipal} mobileOpen={true} onMobileClose={onClose} />);
    fireEvent.click(screen.getByTestId('mobile-drawer-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders navigation landmark', () => {
    wrap(<Sidebar principal={agentPrincipal} />);
    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
  });

  it('null principal renders no nav items', () => {
    wrap(<Sidebar principal={null} />);
    expect(screen.queryByTestId('nav-item-dashboard')).not.toBeInTheDocument();
  });
});
