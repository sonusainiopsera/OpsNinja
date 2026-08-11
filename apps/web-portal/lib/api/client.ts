'use client';

import { SessionManager, createOpsninjaQueryClient } from '@opsninja/api-client';
import type { ClientConfig } from '@opsninja/api-client';

const BASE_URL = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? '/';

const apiConfig: ClientConfig = {
  baseUrl: BASE_URL,
  timeoutMs: 15_000,
};

/**
 * Shared SessionManager for the web-portal app.
 * Handles single-flight token refresh and 401 disambiguation.
 */
export const sessionManager = new SessionManager({
  config: apiConfig,
  onSessionEvent: (event) => {
    if (event === 'unauthenticated' || event === 'reauthorization-required') {
      window.location.assign('/login?reason=' + event);
    }
  },
});

/**
 * Shared TanStack Query client for the web-portal app.
 */
export const queryClient = createOpsninjaQueryClient();

export { apiConfig };
