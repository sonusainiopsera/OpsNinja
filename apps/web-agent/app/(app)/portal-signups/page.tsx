/**
 * Portal Signups admin queue page (WO-091, AC10).
 *
 * Route: /portal-signups
 * Access: support_admin role (enforced by middleware/layout RBAC).
 */

'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PendingSignupsPage } from '../../../features/portal-signups/PendingSignupsPage';

// Create a scoped QueryClient so this page doesn't bleed into the global one
// during unit tests. In the real app the app-level QueryClientProvider
// (in the root layout) is used instead — this boundary is a fallback.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function PortalSignupsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <div
        style={{
          padding: '24px 32px',
          maxWidth: 1440,
          margin: '0 auto',
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        }}
      >
        <PendingSignupsPage />
      </div>
    </QueryClientProvider>
  );
}
