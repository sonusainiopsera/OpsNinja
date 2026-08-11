/**
 * useIdentity — TanStack Query hooks for principal and org scope.
 *
 * These hooks wrap the WOREF-021 API client. They are defined here so the
 * shell components depend on the hook interface, not the client directly.
 * When WOREF-021 ships, replace the fetch call inside each hook with the
 * typed client method.
 *
 * Both hooks use staleTime=30s so the shell re-validates quietly in the
 * background without blocking navigation.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import type { AgentRole } from '../navigation/navConfig';

export interface Principal {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: AgentRole;
  readonly roles: readonly AgentRole[];
  readonly tenantId: string;
}

export interface OrgScope {
  readonly organizations: ReadonlyArray<{ id: string; name: string }>;
  readonly currentOrgId: string | null;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    traceId?: string;
  };
}

async function fetchCurrentPrincipal(): Promise<Principal> {
  const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorEnvelope | null;
    const err = Object.assign(new Error(body?.error?.message ?? 'Identity fetch failed'), {
      traceId: body?.error?.traceId,
      status: res.status,
    });
    throw err;
  }
  return res.json() as Promise<Principal>;
}

async function fetchOrgScope(): Promise<OrgScope> {
  const res = await fetch('/api/v1/auth/scope', { credentials: 'include' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorEnvelope | null;
    const err = Object.assign(new Error(body?.error?.message ?? 'Scope fetch failed'), {
      traceId: body?.error?.traceId,
      status: res.status,
    });
    throw err;
  }
  return res.json() as Promise<OrgScope>;
}

export function useCurrentPrincipal() {
  return useQuery<Principal, Error & { traceId?: string; status?: number }>({
    queryKey: ['identity', 'principal'],
    queryFn: fetchCurrentPrincipal,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      // Do not retry 401 — the API client session layer handles re-auth
      if ((error as { status?: number }).status === 401) return false;
      return failureCount < 2;
    },
  });
}

export function useOrgScope() {
  return useQuery<OrgScope, Error & { traceId?: string; status?: number }>({
    queryKey: ['identity', 'scope'],
    queryFn: fetchOrgScope,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if ((error as { status?: number }).status === 401) return false;
      return failureCount < 2;
    },
  });
}
