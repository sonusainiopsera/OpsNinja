'use client';

import React, { Suspense, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SkipToContent } from './SkipToContent';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ShellErrorBoundary } from './ShellErrorBoundary';
import { ExportProvider } from '@/lib/export/ExportContext';
import { useCurrentPrincipal } from '@/lib/identity/useIdentity';
import type { PrincipalSnapshot } from '@/lib/navigation/canFor';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 5 * 60 * 1000 },
  },
});

interface AppShellInnerProps {
  children: React.ReactNode;
}

function AppShellInner({ children }: AppShellInnerProps) {
  const { data: principal } = useCurrentPrincipal();
  const [mobileOpen, setMobileOpen] = useState(false);

  const principalSnapshot: PrincipalSnapshot | null = principal
    ? { roles: principal.roles }
    : null;

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--color-page-bg, #f9fafb)',
      }}
    >
      {/* Desktop sidebar — hidden via media query at narrow viewports */}
      <div
        data-testid="sidebar-wrapper"
        style={{ display: 'contents' }}
        // Note: CSS handles responsive hide — the sidebar renders on server,
        // media query from the host stylesheet hides it at ≤768px.
        // The mobile drawer is separately rendered when mobileOpen=true.
      >
        <Sidebar
          principal={principalSnapshot}
          mobileOpen={false}
          onMobileClose={() => setMobileOpen(false)}
        />
      </div>

      {/* Mobile drawer portal */}
      {mobileOpen && (
        <Sidebar
          principal={principalSnapshot}
          mobileOpen={true}
          onMobileClose={() => setMobileOpen(false)}
        />
      )}

      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar
          showMenuButton={true}
          onMenuToggle={() => setMobileOpen(o => !o)}
        />

        <main
          id="main-content"
          tabIndex={-1}
          role="main"
          style={{ flex: 1, padding: '1.5rem', outline: 'none' }}
        >
          <ShellErrorBoundary>
            <Suspense fallback={<ShellSkeleton />}>
              {children}
            </Suspense>
          </ShellErrorBoundary>
        </main>

        <footer
          role="contentinfo"
          style={{
            padding: '0.75rem 1.5rem',
            borderTop: '1px solid var(--color-border, #e5e7eb)',
            fontSize: '0.75rem',
            color: 'var(--color-muted, #9ca3af)',
          }}
        >
          © {new Date().getFullYear()} OpsNinja
        </footer>
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div
      aria-label="Loading page content"
      aria-busy="true"
      style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
    >
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={i}
          style={{
            height: '5rem',
            background: 'var(--color-skeleton, #e5e7eb)',
            borderRadius: '0.5rem',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  );
}

export function AppShell({ children }: AppShellInnerProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ExportProvider>
        <ShellErrorBoundary>
          <AppShellInner>{children}</AppShellInner>
        </ShellErrorBoundary>
      </ExportProvider>
    </QueryClientProvider>
  );
}
