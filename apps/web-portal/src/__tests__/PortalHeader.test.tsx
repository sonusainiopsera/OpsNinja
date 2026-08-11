import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PortalHeader } from '../../components/shell/PortalHeader';
import { portalPrincipal, portalPrincipalNoLogo, orgWithLogo, orgWithoutLogo } from '../fixtures/portal.fixtures';

describe('PortalHeader', () => {
  it('renders org logo when logoUrl is present', () => {
    render(<PortalHeader principal={portalPrincipal} org={orgWithLogo} />);
    const img = screen.getByTestId('org-logo') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toContain('acme.png');
    expect(img.alt).toBe(orgWithLogo.name);
  });

  it('renders initials fallback when org has no logo', () => {
    render(<PortalHeader principal={portalPrincipalNoLogo} org={orgWithoutLogo} />);
    expect(screen.queryByTestId('org-logo')).toBeNull();
    const initials = screen.getByTestId('org-logo-initials');
    expect(initials).toBeInTheDocument();
    expect(initials.textContent).toBe('GI');
  });

  it('renders initials fallback when img src fails to load', () => {
    render(<PortalHeader principal={portalPrincipal} org={orgWithLogo} />);
    const img = screen.getByTestId('org-logo');
    // Simulate image load error
    img.dispatchEvent(new Event('error'));
    // After error, initials should appear
    expect(screen.getByTestId('org-logo-initials')).toBeInTheDocument();
  });

  it('renders org scope pill with org name', () => {
    render(<PortalHeader principal={portalPrincipal} org={orgWithLogo} />);
    const pill = screen.getByTestId('org-scope-pill');
    expect(pill.textContent).toBe(orgWithLogo.name);
  });

  it('renders help link', () => {
    render(<PortalHeader principal={portalPrincipal} org={orgWithLogo} />);
    expect(screen.getByTestId('help-link')).toBeInTheDocument();
  });

  it('renders theme toggle', () => {
    render(<PortalHeader principal={portalPrincipal} org={orgWithLogo} />);
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
  });

  it('renders user menu trigger with principal name', () => {
    render(<PortalHeader principal={portalPrincipal} org={orgWithLogo} />);
    expect(screen.getByTestId('portal-user-name').textContent).toBe(portalPrincipal.name);
  });

  it('has role=banner on the header element', () => {
    render(<PortalHeader principal={portalPrincipal} org={orgWithLogo} />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('does NOT render a TenantSwitcher anywhere in the header', () => {
    render(<PortalHeader principal={portalPrincipal} org={orgWithLogo} />);
    expect(screen.queryByTestId('tenant-switcher')).toBeNull();
    expect(document.querySelector('[data-testid="tenant-switcher"]')).toBeNull();
  });
});
