/**
 * Portal API client — portal-specific configuration.
 *
 * This is a stub for the WOREF-021 shared api-client.
 * All 401 handling is delegated to the session layer here.
 * The portal never implements its own refresh or redirect logic.
 */

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

/** Stub: returns mock portal identity. Replace with real fetch when WOREF-021 is ready. */
export async function fetchPortalIdentity(): Promise<PortalIdentityResponse> {
  return {
    principal: {
      id: 'prt_stub',
      name: 'Portal User',
      email: 'user@acme.example.com',
      organization: { id: 'org_stub', name: 'Acme Corp' },
    },
    pendingSurvey: null,
  };
}

/** Sign out: delegates to api-client session layer. */
export function portalSignOut(): void {
  window.location.href = '/api/v1/auth/logout';
}
