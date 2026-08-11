import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect } from 'vitest';
import { SidebarItem } from '../components/SidebarItem/SidebarItem.js';

describe('SidebarItem', () => {
  it('renders label', () => {
    render(<SidebarItem label="Dashboard" />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders as anchor when href provided', () => {
    render(<SidebarItem label="Dashboard" href="/dashboard" />);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
  });

  it('marks active item with aria-current', () => {
    render(<SidebarItem label="Dashboard" href="/dashboard" active />);
    expect(screen.getByRole('link')).toHaveAttribute('aria-current', 'page');
  });

  it('shows sr-only label when collapsed', () => {
    render(<SidebarItem label="Dashboard" collapsed />);
    const srOnly = screen.getByText('Dashboard');
    expect(srOnly).toHaveClass('sr-only');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<SidebarItem label="Dashboard" href="/dashboard" />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
