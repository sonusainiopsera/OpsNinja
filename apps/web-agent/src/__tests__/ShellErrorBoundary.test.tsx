import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShellErrorBoundary } from '@/components/shell/ShellErrorBoundary';

// Suppress console.error for error boundary tests
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function ThrowingComponent({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw Object.assign(new Error('Test error'), { traceId: 'trace-abc-123' });
  return <div>Content</div>;
}

function ThrowingComponentNoTrace() {
  throw new Error('Error without trace');
  return null;
}

describe('ShellErrorBoundary', () => {
  it('renders children when no error', () => {
    render(<ShellErrorBoundary><div>OK</div></ShellErrorBoundary>);
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('renders error state on throw', () => {
    render(<ShellErrorBoundary><ThrowingComponent /></ShellErrorBoundary>);
    expect(screen.getByTestId('shell-error-boundary')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('displays traceId when available', () => {
    render(<ShellErrorBoundary><ThrowingComponent /></ShellErrorBoundary>);
    expect(screen.getByTestId('error-trace-id')).toHaveTextContent('trace-abc-123');
  });

  it('does not render traceId element when unavailable', () => {
    render(<ShellErrorBoundary><ThrowingComponentNoTrace /></ShellErrorBoundary>);
    expect(screen.queryByTestId('error-trace-id')).not.toBeInTheDocument();
  });

  it('renders retry button', () => {
    render(<ShellErrorBoundary><ThrowingComponent /></ShellErrorBoundary>);
    expect(screen.getByTestId('error-retry-button')).toBeInTheDocument();
  });

  it('retry button resets error state', () => {
    const { rerender } = render(
      <ShellErrorBoundary>
        <ThrowingComponent />
      </ShellErrorBoundary>,
    );
    expect(screen.getByTestId('shell-error-boundary')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('error-retry-button'));

    // After retry, error boundary resets — rerender with non-throwing child
    rerender(
      <ShellErrorBoundary>
        <div data-testid="recovered">Recovered</div>
      </ShellErrorBoundary>,
    );
    expect(screen.getByTestId('recovered')).toBeInTheDocument();
  });

  it('error message does not expose raw stack trace', () => {
    render(<ShellErrorBoundary><ThrowingComponent /></ShellErrorBoundary>);
    const boundary = screen.getByTestId('shell-error-boundary');
    expect(boundary.textContent).not.toMatch(/at \w+ \(/); // stack trace pattern
    expect(boundary.textContent).not.toMatch(/node_modules/);
  });
});
