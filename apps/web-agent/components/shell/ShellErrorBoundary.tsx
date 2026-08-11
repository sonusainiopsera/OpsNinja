'use client';

/**
 * ShellErrorBoundary — global error boundary for the app shell.
 *
 * Renders a recoverable panel with traceId when available.
 * NEVER exposes stack traces or raw error payloads.
 */

import React from 'react';

interface ApiError {
  error?: {
    code?: string;
    message?: string;
    traceId?: string;
  };
}

function extractTraceId(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const maybeApi = error as ApiError;
  return maybeApi.error?.traceId ?? null;
}

interface State {
  hasError: boolean;
  traceId: string | null;
}

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export class ShellErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, traceId: null };
  }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, traceId: extractTraceId(error) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // Structured log — no raw stack trace in production output
    const traceId = extractTraceId(error);
    console.error('[ShellErrorBoundary]', {
      traceId,
      componentStack: info.componentStack?.slice(0, 500),
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, traceId: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 300,
          gap: 16,
          padding: 32,
          color: 'var(--color-error-fg, #991b1b)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>Something went wrong</h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-muted, #6b7280)' }}>
          An unexpected error occurred. You can try again or contact support.
        </p>
        {this.state.traceId && (
          <code
            aria-label="Error trace ID"
            style={{
              fontSize: 12,
              background: 'var(--color-bg-alt, #f3f4f6)',
              padding: '4px 8px',
              borderRadius: 4,
              userSelect: 'all',
            }}
          >
            Trace ID: {this.state.traceId}
          </code>
        )}
        <button
          onClick={this.handleRetry}
          style={{
            padding: '8px 20px',
            background: 'var(--color-accent, #4f46e5)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Retry
        </button>
      </div>
    );
  }
}
