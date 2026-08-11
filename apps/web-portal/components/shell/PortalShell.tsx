'use client';

import React, { Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PortalErrorBoundary } from './PortalErrorBoundary';
import { PortalHeader } from './PortalHeader';
import { PortalTabs } from './PortalTabs';
import { CsatBanner } from './CsatBanner';
import { PortalFooter } from './PortalFooter';
import { usePortalIdentity } from '../../lib/identity/usePortalIdentity';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
    },
  },
});

function ShellSkeleton() {
  return (
    <div data-testid="portal-shell-skeleton" aria-busy="true" aria-label="Loading portal">
      <div
        style={{
          height: '3.5rem',
          background: 'var(--color-surface-alt, #f3f4f6)',
          borderBottom: '1px solid var(--color-border, #e5e7eb)',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      />
      <div
        style={{
          height: '2.75rem',
          background: 'var(--color-surface-alt, #f3f4f6)',
          borderBottom: '1px solid var(--color-border, #e5e7eb)',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      />
    </div>
  );
}

function PortalIdentityError({ message, traceId }: { message: string; traceId?: string }) {
  return (
    <div
      role="alert"
      data-testid="portal-identity-error"
      style={{
        padding: '1rem 1.5rem',
        background: 'var(--color-danger-bg, #fef2f2)',
        borderBottom: '1px solid var(--color-danger-border, #fecaca)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '0.875rem',
      }}
    >
      <span style={{ color: 'var(--color-danger, #dc2626)' }}>{message}</span>
      {traceId && (
        <span
          data-testid="identity-error-trace-id"
          style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--color-muted, #6b7280)' }}
        >
          (Trace: {traceId})
        </span>
      )}
    </div>
  );
}

function PortalShellInner({ children }: { children: React.ReactNode }) {
  const { data, isLoading, error } = usePortalIdentity();

  if (isLoading) {
    return (
      <>
        <ShellSkeleton />
        <main id="main-content" role="main" style={{ flex: 1, padding: '1.5rem' }}>
          {children}
        </main>
        <PortalFooter />
      </>
    );
  }

  if (error || !data) {
    const traceId = (error as { traceId?: string } | null)?.traceId;
    const message = error?.message ?? 'Unable to load your profile. Please refresh.';
    return (
      <>
        <PortalIdentityError message={message} traceId={traceId} />
        <main id="main-content" role="main" style={{ flex: 1, padding: '1.5rem' }}>
          {/* Navigation and footer remain usable even on identity failure */}
        </main>
        <PortalFooter />
      </>
    );
  }

  const { principal, pendingSurvey } = data;

  return (
    <>
      <PortalHeader principal={principal} org={principal.org} />
      <PortalTabs />
      {pendingSurvey && <CsatBanner survey={pendingSurvey} />}
      <main id="main-content" role="main" style={{ flex: 1, padding: '1.5rem' }}>
        {children}
      </main>
      <PortalFooter />
    </>
  );
}

interface PortalShellProps {
  children: React.ReactNode;
}

export function PortalShell({ children }: PortalShellProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <PortalErrorBoundary>
        <div
          data-testid="portal-shell"
          style={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: '100vh',
          }}
        >
          <Suspense fallback={<ShellSkeleton />}>
            <PortalShellInner>{children}</PortalShellInner>
          </Suspense>
        </div>
      </PortalErrorBoundary>
    </QueryClientProvider>
  );
}
