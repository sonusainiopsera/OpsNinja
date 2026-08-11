import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortalUserMenu } from '../../components/shell/PortalUserMenu';
import { portalPrincipal } from '../fixtures/portal.fixtures';

describe('PortalUserMenu', () => {
  it('renders trigger with principal name', () => {
    render(<PortalUserMenu principal={portalPrincipal} />);
    expect(screen.getByTestId('portal-user-name').textContent).toBe(portalPrincipal.name);
  });

  it('menu is not visible initially', () => {
    render(<PortalUserMenu principal={portalPrincipal} />);
    expect(screen.queryByTestId('portal-user-menu')).toBeNull();
  });

  it('opens menu on trigger click', () => {
    render(<PortalUserMenu principal={portalPrincipal} />);
    fireEvent.click(screen.getByTestId('portal-user-menu-trigger'));
    expect(screen.getByTestId('portal-user-menu')).toBeInTheDocument();
  });

  it('shows name and email in menu', () => {
    render(<PortalUserMenu principal={portalPrincipal} />);
    fireEvent.click(screen.getByTestId('portal-user-menu-trigger'));
    expect(screen.getByTestId('portal-user-menu-name').textContent).toBe(portalPrincipal.name);
    expect(screen.getByTestId('portal-user-menu-email').textContent).toBe(portalPrincipal.email);
  });

  it('closes menu on Escape key', () => {
    render(<PortalUserMenu principal={portalPrincipal} />);
    fireEvent.click(screen.getByTestId('portal-user-menu-trigger'));
    expect(screen.getByTestId('portal-user-menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('portal-user-menu')).toBeNull();
  });

  it('calls logout endpoint and redirects on sign-out click', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(null, { status: 200 }));
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });

    render(<PortalUserMenu principal={portalPrincipal} />);
    fireEvent.click(screen.getByTestId('portal-user-menu-trigger'));
    fireEvent.click(screen.getByTestId('portal-sign-out'));

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/portal/v1/auth/logout', expect.objectContaining({ method: 'POST' }));
    });

    fetchSpy.mockRestore();
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
  });

  it('trigger has aria-haspopup=menu and aria-expanded=false when closed', () => {
    render(<PortalUserMenu principal={portalPrincipal} />);
    const trigger = screen.getByTestId('portal-user-menu-trigger');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('trigger has aria-expanded=true when open', () => {
    render(<PortalUserMenu principal={portalPrincipal} />);
    const trigger = screen.getByTestId('portal-user-menu-trigger');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
});
