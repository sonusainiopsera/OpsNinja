import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { PriorityBadge } from './PriorityBadge';
import type { Priority } from './PriorityBadge';

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4'];
const DESCRIPTIONS: Record<Priority, string> = {
  P1: 'Critical',
  P2: 'High',
  P3: 'Medium',
  P4: 'Low',
};

describe('PriorityBadge', () => {
  it.each(PRIORITIES)('renders %s with correct text and aria-label', (priority) => {
    const { container } = render(<PriorityBadge priority={priority} />);
    const el = container.querySelector(`[data-priority="${priority}"]`);
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe(priority);
    expect(el?.getAttribute('aria-label')).toBe(`Priority: ${DESCRIPTIONS[priority]}`);
  });

  it('applies className', () => {
    const { container } = render(<PriorityBadge priority="P1" className="custom" />);
    expect(container.querySelector('.custom')).not.toBeNull();
  });
});
