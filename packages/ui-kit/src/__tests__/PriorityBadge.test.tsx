import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriorityBadge } from '../domain/PriorityBadge/PriorityBadge';

describe('PriorityBadge', () => {
  it.each(['p1', 'p2', 'p3', 'p4'] as const)('renders %s with data attribute', (priority) => {
    render(<PriorityBadge priority={priority} />);
    expect(screen.getByTestId('priority-badge')).toHaveAttribute('data-priority', priority);
  });

  it('renders short label by default', () => {
    render(<PriorityBadge priority="p1" />);
    expect(screen.getByTestId('priority-badge')).toHaveTextContent('P1');
  });

  it('renders full label in verbose mode', () => {
    render(<PriorityBadge priority="p1" verbose />);
    expect(screen.getByTestId('priority-badge')).toHaveTextContent('Critical');
  });

  it('has accessible aria-label', () => {
    render(<PriorityBadge priority="p1" />);
    expect(screen.getByTestId('priority-badge').getAttribute('aria-label')).toBe('Priority 1 Critical');
  });

  it('has role=img', () => {
    render(<PriorityBadge priority="p2" />);
    expect(screen.getByTestId('priority-badge')).toHaveAttribute('role', 'img');
  });
});
