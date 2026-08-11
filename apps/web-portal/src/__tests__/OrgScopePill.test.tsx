import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { OrgScopePill } from '../../components/shell/OrgScopePill';

describe('OrgScopePill', () => {
  it('renders the org name', () => {
    render(<OrgScopePill orgName="Acme Corporation" />);
    const pill = screen.getByTestId('org-scope-pill');
    expect(pill.textContent).toBe('Acme Corporation');
  });

  it('has role=status', () => {
    render(<OrgScopePill orgName="Acme Corporation" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has accessible aria-label containing org name', () => {
    render(<OrgScopePill orgName="Acme Corporation" />);
    const pill = screen.getByTestId('org-scope-pill');
    expect(pill.getAttribute('aria-label')).toContain('Acme Corporation');
  });

  it('renders long org name', () => {
    const longName = 'The Very Long Organization Name That Will Overflow Its Container';
    render(<OrgScopePill orgName={longName} />);
    expect(screen.getByTestId('org-scope-pill').textContent).toBe(longName);
  });

  it('is focusable via keyboard', () => {
    render(<OrgScopePill orgName="Acme" />);
    const pill = screen.getByTestId('org-scope-pill');
    expect(pill.getAttribute('tabindex')).toBe('0');
  });
});
