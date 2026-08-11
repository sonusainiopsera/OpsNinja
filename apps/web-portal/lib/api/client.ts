/**
 * Portal API client — thin factory over @opsninja/api-client.
 *
 * Configures:
 *   - Base URL from NEXT_PUBLIC_API_BASE_URL (or default to same-origin /api/v1)
 *   - 15-second request timeout
 *   - Session events: unauthenticated → redirect to /portal/login
 *                     reauthorization-required → redirect to /portal/login?reason=scope_changed
 *
 * 404 rule: isNotFound() must NEVER be rendered as a permission message.
 * The API returns 404 for out-of-scope resources to avoid existence disclosure.
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
    window.location.href = '/portal/login';
  } else if (event === 'reauthorization-required') {
    window.location.href = '/portal/login?reason=scope_changed';
  }
});

export const queryClient = createOpsninjaQueryClient();

export const { request, session } = apiClient;

// ── Legacy portal identity types (kept for backward compat with existing components) ──

export interface PortalOrganization {
  id: string;
  name: string;
  logoUrl?: string;
}

export interface PortalPrincipal {
  id: string;
  name: string;
  email: string;
  organization: PortalOrganization;
}

export interface PendingSurvey {
  id: string;
  ticketId: string;
  ticketSubject: string;
}

export interface PortalIdentityResponse {
  principal: PortalPrincipal;
  pendingSurvey: PendingSurvey | null;
}

/** Fetch portal identity via the shared api-client. */
export async function fetchPortalIdentity(): Promise<PortalIdentityResponse> {
  return request<PortalIdentityResponse>({ path: '/api/v1/portal/identity' });
}

/** Sign out — POST to logout endpoint. */
export async function portalSignOut(): Promise<void> {
  await request({ method: 'POST', path: '/api/v1/auth/logout' }).catch(() => {
    // Always redirect even if the logout request fails.
  });
  window.location.href = '/portal/login';
}
