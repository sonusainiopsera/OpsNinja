/**
 * TanStack Query hooks for the SLA settings page — WO-049.
 *
 * All hooks consume the { error: { code, message, details, traceId } } API
 * envelope. Mutations invalidate the policy list on success.
 */

'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type {
  SlaPolicy,
  SlaPoliciesListResponse,
  SlaPolicyResponse,
  SlaCalendarsListResponse,
  SlaCalendar,
  SchedulerHealthResponse,
  SchedulerHealth,
  SlaPolicyFormValues,
} from './types';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const slaQueryKeys = {
  all: ['sla'] as const,
  policies: () => [...slaQueryKeys.all, 'policies'] as const,
  policy: (id: string) => [...slaQueryKeys.all, 'policies', id] as const,
  calendars: () => [...slaQueryKeys.all, 'calendars'] as const,
  schedulerHealth: () => [...slaQueryKeys.all, 'scheduler-health'] as const,
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const err = new Error((body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`);
    (err as Error & { status: number; body: unknown }).status = res.status;
    (err as Error & { status: number; body: unknown }).body = body;
    throw err;
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// useSlaPolicies
// ---------------------------------------------------------------------------

export function useSlaPolicies(
  opts?: Partial<UseQueryOptions<SlaPolicy[]>>,
) {
  return useQuery<SlaPolicy[]>({
    queryKey: slaQueryKeys.policies(),
    queryFn: async () => {
      const { data } = await apiFetch<SlaPoliciesListResponse>('/api/v1/sla-policies');
      return data;
    },
    staleTime: 30_000,
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// useSlaPolicy
// ---------------------------------------------------------------------------

export function useSlaPolicy(id: string | null) {
  return useQuery<SlaPolicy>({
    queryKey: slaQueryKeys.policy(id ?? ''),
    queryFn: async () => {
      const { data } = await apiFetch<SlaPolicyResponse>(`/api/v1/sla-policies/${id}`);
      return data;
    },
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// useSaveSlaPolicy
// ---------------------------------------------------------------------------

export interface SaveSlaPolicyInput {
  id?: string;                  // undefined → POST (create); defined → PUT (update)
  version?: number;             // required for PUT (optimistic concurrency)
  payload: SlaPolicyFormValues;
}

export interface SaveSlaPolicyResult {
  data: SlaPolicy;
}

export function useSaveSlaPolicy() {
  const qc = useQueryClient();

  return useMutation<SlaPolicy, Error & { status?: number; body?: unknown }, SaveSlaPolicyInput>({
    mutationFn: async ({ id, version, payload }) => {
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/v1/sla-policies/${id}` : '/api/v1/sla-policies';
      const body = id && version !== undefined ? { ...payload, version } : payload;
      const { data } = await apiFetch<SaveSlaPolicyResult>(url, {
        method,
        body: JSON.stringify(body),
      });
      return data;
    },
    onSuccess: (_data, { id }) => {
      // Invalidate list and the specific policy cache
      void qc.invalidateQueries({ queryKey: slaQueryKeys.policies() });
      if (id) void qc.invalidateQueries({ queryKey: slaQueryKeys.policy(id) });
    },
  });
}

// ---------------------------------------------------------------------------
// useSlaCalendars
// ---------------------------------------------------------------------------

export function useSlaCalendars() {
  return useQuery<SlaCalendar[]>({
    queryKey: slaQueryKeys.calendars(),
    queryFn: async () => {
      const { data } = await apiFetch<SlaCalendarsListResponse>('/api/v1/sla-calendars');
      return data;
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// useSchedulerHealth (polling — 30s interval)
// ---------------------------------------------------------------------------

export function useSchedulerHealth() {
  return useQuery<SchedulerHealth>({
    queryKey: slaQueryKeys.schedulerHealth(),
    queryFn: async () => {
      try {
        const { data } = await apiFetch<SchedulerHealthResponse>(
          '/api/v1/sla-policies/scheduler-health',
        );
        return data;
      } catch {
        // Fail to unknown — never optimistically show healthy
        return { status: 'unknown', lagMs: null, checkedAt: new Date().toISOString() };
      }
    },
    refetchInterval: 30_000,
    staleTime: 30_000,
  });
}
