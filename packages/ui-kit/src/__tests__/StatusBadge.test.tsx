import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../domain/StatusBadge/StatusBadge';

const statuses = ['open', 'in_progress', 'pending', 'resolved', 'closed'] as const;

describe('StatusBadge', () => {
  it.each(statuses)('renders %s status', (status) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByTestId('status-badge')).toHaveAttribute('data-status', status);
  });

  it('renders label text for open', () => {
    render(<StatusBadge status="open" />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Open');
  });

  it('renders label text for in_progress', () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByTestId('status-badge')).toHaveTextContent('In Progress');
  });

  it('has accessible aria-label', () => {
    render(<StatusBadge status="resolved" />);
    expect(screen.getByTestId('status-badge').getAttribute('aria-label')).toBe('Status: Resolved');
  });

  it('has role=img', () => {
    render(<StatusBadge status="open" />);
    expect(screen.getByTestId('status-badge')).toHaveAttribute('role', 'img');
  });

  it('renders icon element', () => {
    render(<StatusBadge status="open" />);
    expect(screen.getByTestId('status-badge').querySelector('[data-icon]')).toBeTruthy();
  });
});
