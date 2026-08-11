import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { SlaClockProvider } from '../SlaClockProvider';
import { SlaCountdown } from './SlaCountdown';
import { BASE_SERVER_NOW, BASE_TARGET_FUTURE, BASE_TARGET_PAST } from '../../../test/fixtures/sla.fixtures';

function Wrapper({ children }: { children: React.ReactNode }) {
  const fakeClock = { now: vi.fn(() => 0) };
  return (
    <SlaClockProvider clock={fakeClock} intervalMs={100}>
      {children}
    </SlaClockProvider>
  );
}

describe('SlaCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders running state with positive time remaining', () => {
    render(
      <SlaClockProvider intervalMs={100}>
        <SlaCountdown
          targetAt={BASE_TARGET_FUTURE}
          serverNow={BASE_SERVER_NOW}
          pausedMs={0}
          state="running"
        />
      </SlaClockProvider>,
    );
    // 60 minutes remaining — should render some MM:SS form
    const text = screen.getByText(/\d{2}:\d{2}/);
    expect(text).toBeDefined();
  });

  it('shows breached state for past target', () => {
    render(
      <SlaClockProvider intervalMs={100}>
        <SlaCountdown
          targetAt={BASE_TARGET_PAST}
          serverNow={BASE_SERVER_NOW}
          pausedMs={0}
          state="breached"
        />
      </SlaClockProvider>,
    );
    const el = document.querySelector('[data-sla-state="breached"]');
    expect(el).not.toBeNull();
  });

  it('updates display after timer tick', async () => {
    const fakeClock = { now: vi.fn(() => 0) };
    render(
      <SlaClockProvider clock={fakeClock} intervalMs={100}>
        <SlaCountdown
          targetAt={BASE_TARGET_FUTURE}
          serverNow={BASE_SERVER_NOW}
          pausedMs={0}
          state="running"
        />
      </SlaClockProvider>,
    );

    // Advance the fake monotonic clock by 5 seconds
    fakeClock.now.mockReturnValue(5_000);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // Display should still show a valid MM:SS
    const text = screen.getByText(/\d{2}:\d{2}/);
    expect(text).toBeDefined();
  });

  it('has accessible aria-label', () => {
    render(
      <SlaClockProvider intervalMs={100}>
        <SlaCountdown
          targetAt={BASE_TARGET_FUTURE}
          serverNow={BASE_SERVER_NOW}
          pausedMs={0}
          state="running"
        />
      </SlaClockProvider>,
    );
    const el = document.querySelector('[aria-label]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-label')).toMatch(/SLA/i);
  });
});
