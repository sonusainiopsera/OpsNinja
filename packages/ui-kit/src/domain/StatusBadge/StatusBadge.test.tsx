import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { StatusBadge } from './StatusBadge';
import type { TicketStatus } from './StatusBadge';

const STATUSES: TicketStatus[] = ['open', 'in_progress', 'pending_customer', 'resolved', 'closed'];
const LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  pending_customer: 'Pending Customer',
  resolved: 'Resolved',
  closed: 'Closed',
};

describe('StatusBadge', () => {
  it.each(STATUSES)('renders %s with label and aria-label', (status) => {
    const { container } = render(<StatusBadge status={status} />);
    const el = container.querySelector(`[data-status="${status}"]`);
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe(LABELS[status]);
    expect(el?.getAttribute('aria-label')).toBe(`Status: ${LABELS[status]}`);
  });

  it('applies className prop', () => {
    const { container } = render(<StatusBadge status="open" className="test-class" />);
    expect(container.querySelector('.test-class')).not.toBeNull();
  });
});
