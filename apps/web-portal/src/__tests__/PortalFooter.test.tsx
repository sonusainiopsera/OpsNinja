import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PortalFooter } from '../../components/shell/PortalFooter';

describe('PortalFooter', () => {
  it('renders with role=contentinfo', () => {
    render(<PortalFooter />);
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('renders Privacy Policy link', () => {
    render(<PortalFooter />);
    const link = screen.getByText('Privacy Policy') as HTMLAnchorElement;
    expect(link.href).toContain('/legal/privacy');
  });

  it('renders Terms of Service link', () => {
    render(<PortalFooter />);
    const link = screen.getByText('Terms of Service') as HTMLAnchorElement;
    expect(link.href).toContain('/legal/terms');
  });

  it('renders Contact Support link', () => {
    render(<PortalFooter />);
    const link = screen.getByText('Contact Support') as HTMLAnchorElement;
    expect(link.href).toContain('/support/contact');
  });

  it('renders Accessibility link', () => {
    render(<PortalFooter />);
    const link = screen.getByText('Accessibility') as HTMLAnchorElement;
    expect(link.href).toContain('/legal/accessibility');
  });

  it('has a footer nav with aria-label', () => {
    render(<PortalFooter />);
    expect(screen.getByRole('navigation', { name: /footer links/i })).toBeInTheDocument();
  });
});
