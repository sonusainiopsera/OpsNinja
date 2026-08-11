'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  traceId: string | null;
  errorMessage: string;
}

/**
 * ShellErrorBoundary — catches render/lifecycle errors from any page.
 *
 * Surfaces the API traceId for support without ever exposing raw stack traces
 * or internal error payloads.
 */
export class ShellErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, traceId: null, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    const traceId =
      typeof error === 'object' && error !== null && 'traceId' in error
        ? String((error as { traceId: unknown }).traceId)
        : null;
    const errorMessage =
      error instanceof Error ? error.message : 'An unexpected error occurred.';
    return { hasError: true, traceId, errorMessage };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Structured client-side error log (no stack trace to the user)
    console.error('[ShellErrorBoundary]', {
      message: error.message,
      traceId: (error as { traceId?: string }).traceId ?? null,
      componentStack: info.componentStack,
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, traceId: null, errorMessage: '' });
  };

  override render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        data-testid="shell-error-boundary"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          gap: '1rem',
          minHeight: '100vh',
          background: 'var(--color-surface, #f9fafb)',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
          Something went wrong
        </h1>
        <p style={{ color: 'var(--color-muted, #6b7280)', margin: 0 }}>
          {this.state.errorMessage}
        </p>
        {this.state.traceId && (
          <p
            data-testid="error-trace-id"
            style={{
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              color: 'var(--color-muted, #6b7280)',
              background: 'var(--color-surface-alt, #f3f4f6)',
              padding: '0.25rem 0.5rem',
              borderRadius: '0.25rem',
              userSelect: 'all',
            }}
          >
            Trace ID: {this.state.traceId}
          </p>
        )}
        <button
          onClick={this.handleRetry}
          data-testid="error-retry-button"
          style={{
            padding: '0.5rem 1.5rem',
            background: 'var(--color-accent, #4f46e5)',
            color: '#fff',
            border: 'none',
            borderRadius: '0.375rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }
}
