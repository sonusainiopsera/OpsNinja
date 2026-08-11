import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PortalFooter } from '../../components/shell/PortalFooter';

describe('PortalFooter', () => {
  it('renders contentinfo landmark', () => {
    render(<PortalFooter />);
    expect(screen.getByRole('contentinfo')).toBeTruthy();
  });

  it('has accessible label', () => {
    render(<PortalFooter />);
    const footer = screen.getByRole('contentinfo');
    expect(footer.getAttribute('aria-label')).toBe('Portal footer');
  });

  it('renders footer navigation', () => {
    render(<PortalFooter />);
    expect(screen.getByRole('navigation', { name: 'Footer links' })).toBeTruthy();
  });

  it('renders Privacy Policy link', () => {
    render(<PortalFooter />);
    expect(screen.getByText('Privacy Policy')).toBeTruthy();
  });

  it('renders Terms of Service link', () => {
    render(<PortalFooter />);
    expect(screen.getByText('Terms of Service')).toBeTruthy();
  });

  it('renders Contact Support link', () => {
    render(<PortalFooter />);
    expect(screen.getByText('Contact Support')).toBeTruthy();
  });

  it('renders Status link', () => {
    render(<PortalFooter />);
    expect(screen.getByText('Status')).toBeTruthy();
  });

  it('renders OpsNinja copyright notice', () => {
    render(<PortalFooter />);
    expect(screen.getByText(/OpsNinja/)).toBeTruthy();
  });
});
