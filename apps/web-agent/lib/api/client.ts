/**
 * Agent app API client — thin factory over @opsninja/api-client.
 *
 * Configures:
 *   - Base URL from NEXT_PUBLIC_API_BASE_URL (or default to same-origin /api/v1)
 *   - 15-second request timeout
 *   - Session events: reauthorization-required → redirect to /login?reason=scope_changed
 *                     unauthenticated → redirect to /login
 *
 * 404 rule: isNotFound() errors must NEVER be rendered as permission messages.
 * The API returns 404 for out-of-scope resources to avoid existence disclosure.
 *
 * 409 rule: isConflict() errors carry currentVersion for reload-and-merge;
 * never blindly overwrite — offer the user a "reload changes" path.
 */

import { createOpsninjaClient, createOpsninjaQueryClient } from '@opsninja/api-client';

const baseUrl =
  (typeof process !== 'undefined' && process.env['NEXT_PUBLIC_API_BASE_URL']) ||
  '/api/v1';

export const apiClient = createOpsninjaClient({
  baseUrl,
  timeoutMs: 15_000,
});

// Wire session events once at module load.
apiClient.session.on((event) => {
  if (typeof window === 'undefined') return;
  if (event === 'unauthenticated') {
    window.location.href = '/login';
  } else if (event === 'reauthorization-required') {
    window.location.href = '/login?reason=scope_changed';
  }
});

export const queryClient = createOpsninjaQueryClient();

export const { request, session } = apiClient;
