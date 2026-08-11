'use client';

import { useQuery } from '@tanstack/react-query';

export interface PortalOrg {
  readonly id: string;
  readonly name: string;
  readonly logoUrl?: string | null;
}

export interface PortalPrincipal {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly org: PortalOrg;
}

export interface PendingCsatSurvey {
  readonly surveyId: string;
  readonly ticketId: string;
  readonly prompt: string;
  readonly surveyUrl: string;
}

export interface PortalIdentityResponse {
  readonly principal: PortalPrincipal;
  readonly pendingSurvey: PendingCsatSurvey | null;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    traceId?: string;
  };
}

async function fetchPortalIdentity(): Promise<PortalIdentityResponse> {
  const res = await fetch('/api/portal/v1/me', { credentials: 'include' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorEnvelope | null;
    const err = Object.assign(
      new Error(body?.error?.message ?? 'Portal identity fetch failed'),
      { traceId: body?.error?.traceId, status: res.status },
    );
    throw err;
  }
  return res.json() as Promise<PortalIdentityResponse>;
}

export function usePortalIdentity() {
  return useQuery<PortalIdentityResponse, Error & { traceId?: string; status?: number }>({
    queryKey: ['portal', 'identity'],
    queryFn: fetchPortalIdentity,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      // 401 is handled by the api-client session layer — never retry here
      if ((error as { status?: number }).status === 401) return false;
      return failureCount < 2;
    },
  });
}
