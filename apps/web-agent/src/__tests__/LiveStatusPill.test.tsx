import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveStatusPill } from '@/components/shell/LiveStatusPill';
import { useRealtimeStatusStore } from '@/lib/stores/realtimeStatusStore';
import { realtimeStatuses, realtimeStatusLabels } from '../fixtures/realtime.fixtures';

describe('LiveStatusPill', () => {
  beforeEach(() => {
    useRealtimeStatusStore.setState({ status: 'offline', lastChangedAt: 0 });
  });

  it.each(realtimeStatuses)('renders %s status with text label', (status) => {
    useRealtimeStatusStore.setState({ status, lastChangedAt: 0 });
    render(<LiveStatusPill />);
    const pill = screen.getByTestId('live-status-pill');
    expect(pill).toHaveAttribute('data-status', status);
    expect(pill).toHaveTextContent(realtimeStatusLabels[status]);
  });

  it('includes icon (non-colour channel)', () => {
    useRealtimeStatusStore.setState({ status: 'connected', lastChangedAt: 0 });
    render(<LiveStatusPill />);
    const icon = screen.getByTestId('live-status-pill').querySelector('[aria-hidden]');
    expect(icon).toBeTruthy();
    expect(icon?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('has accessible aria-label describing the state', () => {
    useRealtimeStatusStore.setState({ status: 'reconnecting', lastChangedAt: 0 });
    render(<LiveStatusPill />);
    const label = screen.getByTestId('live-status-pill').getAttribute('aria-label');
    expect(label).toContain('reconnecting');
  });

  it('has role=status', () => {
    render(<LiveStatusPill />);
    expect(screen.getByTestId('live-status-pill')).toHaveAttribute('role', 'status');
  });

  it('state updates reflect in the component', () => {
    useRealtimeStatusStore.setState({ status: 'offline', lastChangedAt: 0 });
    const { rerender } = render(<LiveStatusPill />);
    expect(screen.getByTestId('live-status-pill')).toHaveAttribute('data-status', 'offline');

    useRealtimeStatusStore.setState({ status: 'connected', lastChangedAt: Date.now() });
    rerender(<LiveStatusPill />);
    expect(screen.getByTestId('live-status-pill')).toHaveAttribute('data-status', 'connected');
  });
});
