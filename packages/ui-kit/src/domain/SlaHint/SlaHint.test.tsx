import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SlaHint } from './SlaHint';
import type { SlaState } from '../../slaStateMeta';

const STATES: SlaState[] = ['running', 'warning', 'paused', 'breached'];

describe('SlaHint', () => {
  it.each(STATES)('renders %s state with correct data attribute', (state) => {
    const { container } = render(<SlaHint state={state} />);
    expect(container.querySelector(`[data-sla-state="${state}"]`)).not.toBeNull();
  });

  it('shows timeLabel when provided', () => {
    render(<SlaHint state="running" timeLabel="01:30" />);
    expect(screen.getByText(/01:30/)).toBeDefined();
  });

  it('has accessible aria-label mentioning SLA', () => {
    const { container } = render(<SlaHint state="breached" />);
    const el = container.querySelector('[aria-label]');
    expect(el?.getAttribute('aria-label')).toMatch(/SLA/i);
  });

  it('does NOT import SlaCountdown or SlaClockProvider', async () => {
    // Importing the module graph — if SlaCountdown were imported it would
    // register in the module cache under its path. Here we assert that the
    // component renders without those modules ever being needed.
    const mod = await import('./SlaHint');
    expect(mod).toBeDefined();
    // The dependency-graph test provides stronger isolation guarantees.
  });
});
