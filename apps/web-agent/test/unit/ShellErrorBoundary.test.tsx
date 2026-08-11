import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ShellErrorBoundary } from '../../components/shell/ShellErrorBoundary';

function ThrowOnRender({ error }: { error: unknown }) {
  throw error;
  return null;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('ShellErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ShellErrorBoundary>
        <span data-testid="ok">OK</span>
      </ShellErrorBoundary>,
    );
    expect(screen.getByTestId('ok')).toBeDefined();
  });

  it('renders error panel when child throws', () => {
    render(
      <ShellErrorBoundary>
        <ThrowOnRender error={new Error('boom')} />
      </ShellErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/something went wrong/i)).toBeDefined();
  });

  it('shows traceId when available in error envelope', () => {
    const err = { error: { traceId: 'trc_xyz' } };
    render(
      <ShellErrorBoundary>
        <ThrowOnRender error={err} />
      </ShellErrorBoundary>,
    );
    expect(screen.getByText(/trc_xyz/)).toBeDefined();
  });

  it('does NOT show traceId section when error has no traceId', () => {
    render(
      <ShellErrorBoundary>
        <ThrowOnRender error={new Error('no trace')} />
      </ShellErrorBoundary>,
    );
    expect(screen.queryByText(/trace id/i)).toBeNull();
  });

  it('clears error state on Retry button click', () => {
    const { rerender } = render(
      <ShellErrorBoundary>
        <ThrowOnRender error={new Error('boom')} />
      </ShellErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    // After retry, no more error state (children would remount without error)
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never exposes raw stack traces in the rendered output', () => {
    render(
      <ShellErrorBoundary>
        <ThrowOnRender error={new Error('boom')} />
      </ShellErrorBoundary>,
    );
    const alertText = screen.getByRole('alert').textContent ?? '';
    expect(alertText).not.toMatch(/Error: boom/);
    expect(alertText).not.toMatch(/at \w+/); // no stack frames
  });
});
