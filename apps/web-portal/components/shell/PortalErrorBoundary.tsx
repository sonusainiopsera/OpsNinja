'use client';

import React from 'react';

interface ApiError {
  error?: { traceId?: string };
}

function extractTraceId(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  return (error as ApiError).error?.traceId ?? null;
}

interface State {
  hasError: boolean;
  traceId: string | null;
}

export class PortalErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, traceId: null };
  }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, traceId: extractTraceId(error) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[PortalErrorBoundary]', {
      traceId: extractTraceId(error),
      componentStack: info.componentStack?.slice(0, 500),
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
          gap: 12,
          padding: 32,
          color: 'var(--portal-error-fg, #991b1b)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>Something went wrong</h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--portal-fg-muted, #6b7280)' }}>
          Please try again or contact support.
        </p>
        {this.state.traceId && (
          <code
            aria-label="Error trace ID"
            style={{
              fontSize: 12,
              background: 'var(--portal-bg-alt, #f3f4f6)',
              padding: '4px 8px',
              borderRadius: 4,
              userSelect: 'all',
            }}
          >
            Trace ID: {this.state.traceId}
          </code>
        )}
        <button
          onClick={() => this.setState({ hasError: false, traceId: null })}
          style={{
            padding: '8px 20px',
            background: 'var(--portal-accent, #0ea5e9)',
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
