import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect } from 'vitest';
import { Breadcrumbs } from '../components/Breadcrumbs/Breadcrumbs.js';
import { BREADCRUMB_TRAIL } from '../fixtures/component-fixtures.js';

describe('Breadcrumbs', () => {
  it('renders a nav landmark', () => {
    render(<Breadcrumbs items={BREADCRUMB_TRAIL} />);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
  });

  it('renders all breadcrumb items', () => {
    render(<Breadcrumbs items={BREADCRUMB_TRAIL} />);
    BREADCRUMB_TRAIL.forEach((item) => {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    });
  });

  it('marks last item as current page', () => {
    render(<Breadcrumbs items={BREADCRUMB_TRAIL} />);
    const lastItem = BREADCRUMB_TRAIL[BREADCRUMB_TRAIL.length - 1]!;
    const currentEl = screen.getByText(lastItem.label);
    expect(currentEl).toHaveAttribute('aria-current', 'page');
  });

  it('renders links for non-last items with href', () => {
    render(<Breadcrumbs items={BREADCRUMB_TRAIL} />);
    const homeLink = screen.getByRole('link', { name: 'Home' });
    expect(homeLink).toHaveAttribute('href', '/');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Breadcrumbs items={BREADCRUMB_TRAIL} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
