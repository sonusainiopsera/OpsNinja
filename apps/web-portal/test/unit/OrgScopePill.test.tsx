import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { OrgScopePill } from '../../components/shell/OrgScopePill';
import { ORG_WITH_LOGO, ORG_WITHOUT_LOGO } from '../fixtures/portalPrincipal.fixtures';

describe('OrgScopePill', () => {
  it('renders with data-testid', () => {
    render(<OrgScopePill organization={ORG_WITH_LOGO} />);
    expect(screen.getByTestId('org-scope-pill')).toBeTruthy();
  });

  it('has accessible label including org name', () => {
    render(<OrgScopePill organization={ORG_WITH_LOGO} />);
    const el = screen.getByTestId('org-scope-pill');
    expect(el.getAttribute('aria-label')).toContain('Acme Corp');
  });

  it('renders org name text', () => {
    render(<OrgScopePill organization={ORG_WITH_LOGO} />);
    expect(screen.getByText('Acme Corp')).toBeTruthy();
  });

  it('renders without logo (fallback initials)', () => {
    render(<OrgScopePill organization={ORG_WITHOUT_LOGO} />);
    expect(screen.getByTestId('org-scope-pill')).toBeTruthy();
    expect(screen.getByText('Globex Inc')).toBeTruthy();
  });

  it('has no interactive controls — is read-only', () => {
    const { container } = render(<OrgScopePill organization={ORG_WITH_LOGO} />);
    const buttons = container.querySelectorAll('button');
    const selects = container.querySelectorAll('select');
    expect(buttons.length).toBe(0);
    expect(selects.length).toBe(0);
  });
});
