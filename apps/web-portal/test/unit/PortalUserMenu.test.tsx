import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PortalUserMenu } from '../../components/shell/PortalUserMenu';
import { PORTAL_PRINCIPAL_WITH_LOGO } from '../fixtures/portalPrincipal.fixtures';

vi.mock('../../lib/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api/client')>();
  return { ...mod, portalSignOut: vi.fn() };
});

import { portalSignOut } from '../../lib/api/client';

describe('PortalUserMenu', () => {
  it('renders user name in trigger', () => {
    render(<PortalUserMenu principal={PORTAL_PRINCIPAL_WITH_LOGO} />);
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
  });

  it('trigger has aria-haspopup=menu', () => {
    render(<PortalUserMenu principal={PORTAL_PRINCIPAL_WITH_LOGO} />);
    const trigger = screen.getByRole('button', { name: /User menu/i });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('trigger has aria-expanded=false when closed', () => {
    render(<PortalUserMenu principal={PORTAL_PRINCIPAL_WITH_LOGO} />);
    const trigger = screen.getByRole('button', { name: /User menu/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens menu on trigger click', () => {
    render(<PortalUserMenu principal={PORTAL_PRINCIPAL_WITH_LOGO} />);
    const trigger = screen.getByRole('button', { name: /User menu/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('shows email in open menu', () => {
    render(<PortalUserMenu principal={PORTAL_PRINCIPAL_WITH_LOGO} />);
    fireEvent.click(screen.getByRole('button', { name: /User menu/i }));
    expect(screen.getByText('jane@acme.com')).toBeTruthy();
  });

  it('sign-out button has correct data-testid', () => {
    render(<PortalUserMenu principal={PORTAL_PRINCIPAL_WITH_LOGO} />);
    fireEvent.click(screen.getByRole('button', { name: /User menu/i }));
    expect(screen.getByTestId('portal-sign-out-btn')).toBeTruthy();
  });

  it('calls portalSignOut on sign-out click', () => {
    render(<PortalUserMenu principal={PORTAL_PRINCIPAL_WITH_LOGO} />);
    fireEvent.click(screen.getByRole('button', { name: /User menu/i }));
    fireEvent.click(screen.getByTestId('portal-sign-out-btn'));
    expect(portalSignOut).toHaveBeenCalled();
  });

  it('generates initials from name', () => {
    render(<PortalUserMenu principal={PORTAL_PRINCIPAL_WITH_LOGO} />);
    const { container } = render(<PortalUserMenu principal={PORTAL_PRINCIPAL_WITH_LOGO} />);
    // Look for initials JD
    expect(container.textContent).toContain('JD');
  });
});
