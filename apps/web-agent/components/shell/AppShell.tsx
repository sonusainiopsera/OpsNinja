'use client';

/**
 * AppShell — root shell for all authenticated agent routes.
 *
 * Composes Sidebar + TopBar, owns cross-cutting concerns:
 *   - skip-to-content link
 *   - landmark structure (banner / navigation / main / contentinfo)
 *   - responsive mobile drawer
 *   - identity + org-scope loading with skeletons
 *   - theme management
 *   - export context provider
 */

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SkipToContent } from './SkipToContent';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ShellErrorBoundary } from './ShellErrorBoundary';
import { SidebarSkeleton, TopBarSkeleton } from './ShellSkeletons';
import { ExportProvider } from '../../lib/context/ExportContext';
import { fetchCurrentPrincipal, fetchOrgScope } from '../../lib/api/identity';

interface AppShellProps {
  children: React.ReactNode;
}

function readTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset['theme'] = theme;
  try {
    localStorage.setItem('opsninja.shell.theme', theme);
  } catch {
    // ignore
  }
}

export function AppShell({ children }: AppShellProps) {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Hydrate theme from localStorage
  useEffect(() => {
    const stored = (() => {
      try {
        return localStorage.getItem('opsninja.shell.theme') as 'light' | 'dark' | null;
      } catch {
        return null;
      }
    })();
    const t = stored ?? readTheme();
    setTheme(t);
    applyTheme(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light';
      applyTheme(next);
      return next;
    });
  }, []);

  // Identity
  const principalQuery = useQuery({
    queryKey: ['currentPrincipal'],
    queryFn: fetchCurrentPrincipal,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  // Org scope
  const orgScopeQuery = useQuery({
    queryKey: ['orgScope'],
    queryFn: fetchOrgScope,
    staleTime: 2 * 60_000,
    retry: 1,
  });

  const handleSignOut = useCallback(() => {
    // Delegate to session layer — no local session management in the shell
    window.location.href = '/api/v1/auth/logout';
  }, []);

  const principal = principalQuery.data ?? null;
  const orgScope = orgScopeQuery.data ?? null;

  return (
    <ExportProvider>
      <SkipToContent />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
          background: 'var(--color-bg-page, #f9fafb)',
        }}
      >
        {/* Banner / TopBar */}
        <ShellErrorBoundary>
          <Suspense fallback={<TopBarSkeleton />}>
            <TopBar
              principal={principal}
              onSignOut={handleSignOut}
              onMobileMenuOpen={() => setMobileDrawerOpen(true)}
              theme={theme}
              onThemeToggle={toggleTheme}
            />
          </Suspense>
        </ShellErrorBoundary>

        {/* Body: sidebar + main */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* Navigation landmark */}
          <ShellErrorBoundary>
            <Suspense fallback={<SidebarSkeleton />}>
              <Sidebar
                principal={principal}
                orgScope={orgScope}
                mobileOpen={mobileDrawerOpen}
                onMobileClose={() => setMobileDrawerOpen(false)}
              />
            </Suspense>
          </ShellErrorBoundary>

          {/* Main content landmark */}
          <main
            id="main-content"
            tabIndex={-1}
            aria-label="Page content"
            style={{
              flex: 1,
              overflowY: 'auto',
              outline: 'none',
              padding: 0,
            }}
          >
            <ShellErrorBoundary>
              <Suspense
                fallback={
                  <div
                    aria-label="Loading page"
                    style={{
                      padding: 32,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          height: 20,
                          borderRadius: 4,
                          background: 'var(--color-bg-alt, #e5e7eb)',
                          width: `${80 - i * 10}%`,
                        }}
                      />
                    ))}
                  </div>
                }
              >
                {children}
              </Suspense>
            </ShellErrorBoundary>
          </main>
        </div>

        {/* Footer landmark */}
        <footer
          role="contentinfo"
          aria-label="Site footer"
          style={{
            borderTop: '1px solid var(--color-border, #e5e7eb)',
            padding: '8px 16px',
            fontSize: 11,
            color: 'var(--color-muted, #9ca3af)',
            background: 'var(--color-bg-sidebar, #fff)',
          }}
        >
          OpsNinja Agent Workspace
        </footer>
      </div>
    </ExportProvider>
  );
}
