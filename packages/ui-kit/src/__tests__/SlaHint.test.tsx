import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlaHint } from '../domain/SlaHint/SlaHint';

describe('SlaHint', () => {
  it('renders running state with icon and label', () => {
    render(<SlaHint state="running" />);
    const el = screen.getByTestId('sla-hint');
    expect(el).toHaveAttribute('data-sla-state', 'running');
    expect(el.querySelector('[data-sla-label]')).toHaveTextContent('On Track');
  });

  it('renders warning state', () => {
    render(<SlaHint state="warning" />);
    expect(screen.getByTestId('sla-hint')).toHaveAttribute('data-sla-state', 'warning');
  });

  it('renders paused state', () => {
    render(<SlaHint state="paused" />);
    expect(screen.getByTestId('sla-hint')).toHaveAttribute('data-sla-state', 'paused');
  });

  it('renders breached state', () => {
    render(<SlaHint state="breached" />);
    expect(screen.getByTestId('sla-hint')).toHaveAttribute('data-sla-state', 'breached');
  });

  it('shows displayTime when provided', () => {
    render(<SlaHint state="running" displayTime="2h 15m" />);
    expect(screen.getByTestId('sla-hint').querySelector('[data-sla-time]')).toHaveTextContent('2h 15m');
  });

  it('includes displayTime in aria-label', () => {
    render(<SlaHint state="running" displayTime="2h 15m" />);
    const el = screen.getByTestId('sla-hint');
    expect(el.getAttribute('aria-label')).toContain('2h 15m');
  });

  it('has role=img', () => {
    render(<SlaHint state="running" />);
    expect(screen.getByTestId('sla-hint')).toHaveAttribute('role', 'img');
  });

  it('never requires displayTime — state-only is sufficient', () => {
    // Should render without error
    expect(() => render(<SlaHint state="breached" />)).not.toThrow();
    expect(screen.getByTestId('sla-hint').querySelector('[data-sla-label]')).toHaveTextContent('Breached');
  });
});
