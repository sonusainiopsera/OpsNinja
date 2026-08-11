'use client';

/**
 * PortalShell — root shell for all portal-authenticated routes.
 *
 * Structurally DIFFERENT from the agent AppShell:
 *   - No Sidebar, TenantSwitcher, GlobalSearch, LiveStatusPill, ExportMenu
 *   - OrgScopePill is read-only (one org, no switcher)
 *   - SlaHint instead of SlaCountdown
 *   - Only imports from @opsninja/ui-kit/portal (portal-safe subset)
 */

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SkipToContent } from './SkipToContent';
import { PortalHeader } from './PortalHeader';
import { PortalTabs } from './PortalTabs';
import { CsatBanner } from './CsatBanner';
import { PortalFooter } from './PortalFooter';
import { PortalErrorBoundary } from './PortalErrorBoundary';
import { fetchPortalIdentity } from '../../lib/api/client';

interface PortalShellProps {
  children: React.ReactNode;
}

function readPortalTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset['theme'] === 'dark' ? 'dark' : 'light';
}

function applyPortalTheme(theme: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset['theme'] = theme;
  try {
    localStorage.setItem('opsninja.portal.theme', theme);
  } catch {
    // ignore
  }
}

export function PortalShell({ children }: PortalShellProps) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = (() => {
      try {
        return localStorage.getItem('opsninja.portal.theme') as 'light' | 'dark' | null;
      } catch {
        return null;
      }
    })();
    const t = stored ?? readPortalTheme();
    setTheme(t);
    applyPortalTheme(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light';
      applyPortalTheme(next);
      return next;
    });
  }, []);

  const identityQuery = useQuery({
    queryKey: ['portalIdentity'],
    queryFn: fetchPortalIdentity,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const principal = identityQuery.data?.principal ?? null;
  const pendingSurvey = identityQuery.data?.pendingSurvey ?? null;

  return (
    <>
      <SkipToContent />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          background: 'var(--portal-bg-page, #f9fafb)',
        }}
      >
        {/* Banner */}
        <PortalErrorBoundary>
          <PortalHeader
            principal={principal}
            theme={theme}
            onThemeToggle={toggleTheme}
          />
        </PortalErrorBoundary>

        {/* Navigation landmark */}
        <PortalErrorBoundary>
          <PortalTabs />
        </PortalErrorBoundary>

        {/* CSAT Banner slot */}
        {pendingSurvey && (
          <PortalErrorBoundary>
            <CsatBanner survey={pendingSurvey} />
          </PortalErrorBoundary>
        )}

        {/* Main content */}
        <main
          id="portal-main"
          tabIndex={-1}
          aria-label="Page content"
          style={{
            flex: 1,
            outline: 'none',
            padding: 0,
            overflowX: 'hidden',
          }}
        >
          <PortalErrorBoundary>
            <Suspense
              fallback={
                <div
                  aria-label="Loading page"
                  style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 12 }}
                >
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        height: 20,
                        borderRadius: 4,
                        background: 'var(--portal-bg-alt, #e5e7eb)',
                        width: `${75 - i * 10}%`,
                      }}
                    />
                  ))}
                </div>
              }
            >
              {children}
            </Suspense>
          </PortalErrorBoundary>
        </main>

        {/* Footer */}
        <PortalFooter />
      </div>
    </>
  );
}
