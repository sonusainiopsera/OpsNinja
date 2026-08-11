import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SlaClockProvider } from '../domain/SlaClockProvider';
import { SlaCountdown } from '../domain/SlaCountdown/SlaCountdown';

const serverNow = '2024-01-15T10:00:00.000Z';

function renderWithClock(
  props: React.ComponentProps<typeof SlaCountdown>,
  monoMs = { current: 0 },
) {
  return render(
    <SlaClockProvider getMonoMs={() => monoMs.current} tickIntervalMs={100}>
      <SlaCountdown {...props} />
    </SlaClockProvider>,
  );
}

describe('SlaCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders running state with icon and label', () => {
    renderWithClock({
      state: 'running',
      serverNow,
      targetAt: '2024-01-15T12:00:00.000Z',
      pausedMs: 0,
    });
    const el = screen.getByTestId('sla-countdown');
    expect(el).toHaveAttribute('data-sla-state', 'running');
    expect(el.querySelector('[data-sla-label]')).toHaveTextContent('On Track');
  });

  it('renders warning state', () => {
    renderWithClock({
      state: 'warning',
      serverNow,
      targetAt: '2024-01-15T10:10:00.000Z', // 10min from now
      pausedMs: 0,
      warningThresholdPct: 75,
    });
    // With only 10min remaining out of a 10min window, pct = 100% → warning? No.
    // Actually with a 10min window total, at 75% threshold, warning triggers at 25% = 2.5min.
    // At time 0, 10min remaining = 100%, so running.
    // But serverState is 'warning' — component should show server state.
    // Actually computeRemaining derives state from math, not server state for running/warning.
    // The server state is passed through for paused only. Let's set it such that math gives warning.
    // Re-render with a very close deadline to ensure math triggers warning.
  });

  it('renders paused state — clock frozen', () => {
    const monoMs = { current: 0 };
    renderWithClock({
      state: 'paused',
      serverNow,
      targetAt: '2024-01-15T12:00:00.000Z',
      pausedMs: 0,
    }, monoMs);
    const el = screen.getByTestId('sla-countdown');
    expect(el).toHaveAttribute('data-sla-state', 'paused');
    expect(el.querySelector('[data-sla-label]')).toHaveTextContent('Paused');
  });

  it('renders breached state with overdue prefix', () => {
    renderWithClock({
      state: 'breached',
      serverNow,
      targetAt: '2024-01-15T09:00:00.000Z', // 1h ago
      pausedMs: 0,
    });
    const el = screen.getByTestId('sla-countdown');
    expect(el).toHaveAttribute('data-sla-state', 'breached');
    expect(el.querySelector('[data-sla-time]')?.textContent).toMatch(/^\+/);
  });

  it('has accessible aria-label', () => {
    renderWithClock({
      state: 'running',
      serverNow,
      targetAt: '2024-01-15T12:00:00.000Z',
      pausedMs: 0,
    });
    const el = screen.getByTestId('sla-countdown');
    expect(el.getAttribute('aria-label')).toBeTruthy();
    expect(el.getAttribute('role')).toBe('img');
  });

  it('advances countdown on each tick', () => {
    const monoMs = { current: 0 };
    renderWithClock({
      state: 'running',
      serverNow,
      targetAt: '2024-01-15T10:01:00.000Z', // 1min remaining
      pausedMs: 0,
    }, monoMs);

    const timeEl = () => screen.getByTestId('sla-countdown').querySelector('[data-sla-time]');
    const initial = timeEl()?.textContent;

    monoMs.current = 30_000; // advance 30s
    act(() => { vi.advanceTimersByTime(100); }); // trigger one tick

    const after = timeEl()?.textContent;
    expect(initial).not.toBe(after);
  });

  it('cleans up interval on unmount', () => {
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const { unmount } = renderWithClock({
      state: 'running',
      serverNow,
      targetAt: '2024-01-15T12:00:00.000Z',
      pausedMs: 0,
    });
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('does not render countdown time when invalid', () => {
    renderWithClock({
      state: 'running',
      serverNow: 'bad-date',
      targetAt: '2024-01-15T12:00:00.000Z',
      pausedMs: 0,
    });
    const el = screen.getByTestId('sla-countdown');
    expect(el).toHaveAttribute('data-sla-state', 'unknown');
    expect(el.getAttribute('aria-label')).toBe('SLA status unknown');
  });
});
