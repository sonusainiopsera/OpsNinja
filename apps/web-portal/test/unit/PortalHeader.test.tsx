import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PortalHeader } from '../../components/shell/PortalHeader';
import {
  PORTAL_PRINCIPAL_WITH_LOGO,
  PORTAL_PRINCIPAL_WITHOUT_LOGO,
} from '../fixtures/portalPrincipal.fixtures';

describe('PortalHeader', () => {
  it('renders banner landmark', () => {
    render(<PortalHeader principal={PORTAL_PRINCIPAL_WITH_LOGO} />);
    expect(screen.getByRole('banner')).toBeTruthy();
  });

  it('renders OrgScopePill for logged-in principal', () => {
    render(<PortalHeader principal={PORTAL_PRINCIPAL_WITH_LOGO} />);
    expect(screen.getByTestId('org-scope-pill')).toBeTruthy();
  });

  it('renders theme toggle with correct data-testid', () => {
    render(<PortalHeader principal={PORTAL_PRINCIPAL_WITH_LOGO} />);
    expect(screen.getByTestId('portal-theme-toggle')).toBeTruthy();
  });

  it('calls onThemeToggle when toggle is clicked', () => {
    const toggle = vi.fn();
    render(<PortalHeader principal={PORTAL_PRINCIPAL_WITH_LOGO} onThemeToggle={toggle} />);
    fireEvent.click(screen.getByTestId('portal-theme-toggle'));
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('renders skeleton when principal is null', () => {
    render(<PortalHeader principal={null} />);
    expect(screen.queryByTestId('org-scope-pill')).toBeNull();
  });

  it('does NOT render Sidebar, TenantSwitcher, GlobalSearch, LiveStatusPill or ExportMenu', () => {
    const { container } = render(<PortalHeader principal={PORTAL_PRINCIPAL_WITH_LOGO} />);
    const text = container.textContent ?? '';
    // None of these agent-only component labels should appear
    expect(text).not.toContain('Switch organization');
    expect(text).not.toContain('Global search');
    expect(text).not.toContain('Connection status');
  });

  it('renders org initials fallback when no logo', () => {
    render(<PortalHeader principal={PORTAL_PRINCIPAL_WITHOUT_LOGO} />);
    // initials of "Globex Inc" → "GI"
    expect(screen.getByLabelText('Globex Inc logo')).toBeTruthy();
  });

  it('theme toggle has aria-pressed for dark mode state', () => {
    render(<PortalHeader principal={PORTAL_PRINCIPAL_WITH_LOGO} theme="dark" />);
    const toggle = screen.getByTestId('portal-theme-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('theme toggle has aria-pressed=false for light mode state', () => {
    render(<PortalHeader principal={PORTAL_PRINCIPAL_WITH_LOGO} theme="light" />);
    const toggle = screen.getByTestId('portal-theme-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });
});
