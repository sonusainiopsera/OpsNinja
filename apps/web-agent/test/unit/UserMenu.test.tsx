import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { UserMenu } from '../../components/shell/UserMenu';
import { AGENT_PRINCIPAL, ADMIN_PRINCIPAL } from '../fixtures/principal.fixtures';

describe('UserMenu', () => {
  it('renders principal name', () => {
    render(<UserMenu principal={AGENT_PRINCIPAL} onSignOut={vi.fn()} />);
    expect(screen.getByText(AGENT_PRINCIPAL.name)).toBeDefined();
  });

  it('opens menu on button click showing email and role', () => {
    render(<UserMenu principal={AGENT_PRINCIPAL} onSignOut={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
    expect(screen.getByText(AGENT_PRINCIPAL.email)).toBeDefined();
    expect(screen.getByText(/agent/i)).toBeDefined();
  });

  it('calls onSignOut when sign-out button is clicked', () => {
    const onSignOut = vi.fn();
    render(<UserMenu principal={AGENT_PRINCIPAL} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
    fireEvent.click(screen.getByTestId('sign-out-btn'));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('closes menu after sign-out', () => {
    render(<UserMenu principal={AGENT_PRINCIPAL} onSignOut={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
    fireEvent.click(screen.getByTestId('sign-out-btn'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows role formatted for admin', () => {
    render(<UserMenu principal={ADMIN_PRINCIPAL} onSignOut={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
    expect(screen.getByText(/admin/i)).toBeDefined();
  });

  it('has aria-expanded=false when closed', () => {
    render(<UserMenu principal={AGENT_PRINCIPAL} onSignOut={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /user menu/i });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('has aria-expanded=true when open', () => {
    render(<UserMenu principal={AGENT_PRINCIPAL} onSignOut={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /user menu/i });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });
});
