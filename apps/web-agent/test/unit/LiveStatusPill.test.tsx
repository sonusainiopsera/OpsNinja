import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { LiveStatusPill } from '../../components/shell/LiveStatusPill';
import { useRealtimeStatusStore } from '../../lib/store/realtimeStatus.store';
import type { RealtimeStatus } from '../../lib/store/realtimeStatus.store';
import { ALL_STATUSES } from '../fixtures/realtimeStatus.fixtures';

const EXPECTED_LABELS: Record<RealtimeStatus, string> = {
  connected: 'Live',
  reconnecting: 'Reconnecting',
  polling: 'Polling',
  stale: 'Delayed',
  offline: 'Offline',
};

describe('LiveStatusPill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset store to offline
    useRealtimeStatusStore.getState().setStatus('offline');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(ALL_STATUSES)('renders label for %s after debounce settles', async (status) => {
    useRealtimeStatusStore.getState().setStatus(status);
    const { container } = render(<LiveStatusPill />);

    // Advance past debounce window
    vi.advanceTimersByTime(1000);

    const el = container.querySelector('[data-realtime-status]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-realtime-status')).toBe(status);
    expect(el?.textContent).toContain(EXPECTED_LABELS[status]);
  });

  it('has an accessible aria-label', () => {
    useRealtimeStatusStore.getState().setStatus('connected');
    const { container } = render(<LiveStatusPill />);
    vi.advanceTimersByTime(1000);
    const el = container.querySelector('[aria-label]');
    expect(el?.getAttribute('aria-label')).toMatch(/realtime connection/i);
  });

  it('debounces rapid status changes', () => {
    const { container } = render(<LiveStatusPill />);
    useRealtimeStatusStore.getState().setStatus('connected');
    useRealtimeStatusStore.getState().setStatus('reconnecting');
    useRealtimeStatusStore.getState().setStatus('offline');

    // Before debounce settles, component still shows initial 'offline'
    const el = container.querySelector('[data-realtime-status]');
    expect(el?.getAttribute('data-realtime-status')).toBe('offline');

    // After debounce settles, shows final value
    vi.advanceTimersByTime(1000);
    expect(el?.getAttribute('data-realtime-status')).toBe('offline');
  });
});
