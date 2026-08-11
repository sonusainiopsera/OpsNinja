'use client';

import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

async function enableMocking(): Promise<void> {
  if (process.env['NEXT_PUBLIC_USE_MSW'] !== 'true') return;
  if (typeof window === 'undefined') return;
  const { worker } = await import('../lib/mocks/browser');
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(process.env['NEXT_PUBLIC_USE_MSW'] !== 'true');
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 60_000,
          },
        },
      }),
  );

  useEffect(() => {
    let cancelled = false;
    enableMocking()
      .catch((err) => {
        console.error('[msw] failed to start', err);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div style={{ padding: 24, color: '#6b7280', fontSize: 14 }}>
        Starting local API mocks…
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
