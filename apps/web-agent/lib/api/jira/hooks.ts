/**
 * TanStack Query hooks for Jira Integration Console — WO-058.
 *
 * All mutations surface the structured error envelope; callers handle
 * 403 → permission-denied panel, 409 → reload-and-merge prompt,
 * 429 → cooldown, 503 → stale badge.
 *
 * Health polling: 15-second refetchInterval.
 * No hand-rolled fetch scattered in components — all network calls here.
 */

'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type {
  JiraHealthResponse,
  RotateWebhookSecretResponse,
  JiraProjectsResponse,
  JiraFieldsResponse,
  PaginatedMappingsResponse,
  MappingResponse,
  JiraProjectMapping,
  DlqPageResponse,
  BatchReplayResponse,
  ReplayResult,
  ReconciliationRunsResponse,
  TriggerReconciliationResponse,
  TestConnectionResponse,
} from './types';

// ---------------------------------------------------------------------------
// Fetch helper — consistent error extraction
// ---------------------------------------------------------------------------

export interface ApiError extends Error {
  status: number;
  code: string;
  traceId: string | null;
  retryAfter: number | null;
  body: unknown;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const errBody = body as { error?: { code?: string; message?: string; traceId?: string } } | null;
    const err = new Error(errBody?.error?.message ?? `HTTP ${res.status}`) as ApiError;
    err.status = res.status;
    err.code = errBody?.error?.code ?? 'UNKNOWN';
    err.traceId = errBody?.error?.traceId ?? null;
    err.retryAfter = res.headers.get('Retry-After') ? Number(res.headers.get('Retry-After')) : null;
    err.body = body;
    throw err;
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const jiraQueryKeys = {
  all: ['jira'] as const,
  health: () => [...jiraQueryKeys.all, 'health'] as const,
  projects: (connectionId: string) => [...jiraQueryKeys.all, 'projects', connectionId] as const,
  fields: (connectionId: string, projectKey: string, issueTypeId: string) =>
    [...jiraQueryKeys.all, 'fields', connectionId, projectKey, issueTypeId] as const,
  mappings: (connectionId?: string) =>
    [...jiraQueryKeys.all, 'mappings', connectionId ?? 'all'] as const,
  mapping: (id: string) => [...jiraQueryKeys.all, 'mapping', id] as const,
  dlq: (connectionId?: string, eventType?: string) =>
    [...jiraQueryKeys.all, 'dlq', connectionId ?? 'all', eventType ?? 'all'] as const,
  reconciliationRuns: (connectionId?: string) =>
    [...jiraQueryKeys.all, 'reconciliation', connectionId ?? 'all'] as const,
};

// ---------------------------------------------------------------------------
// useJiraHealth — 15-second polling
// ---------------------------------------------------------------------------

export function useJiraHealth(opts?: Partial<UseQueryOptions<JiraHealthResponse>>) {
  return useQuery<JiraHealthResponse, ApiError>({
    queryKey: jiraQueryKeys.health(),
    queryFn: () => apiFetch<JiraHealthResponse>('/api/v1/integrations/jira/health'),
    refetchInterval: 15_000,
    staleTime: 15_000,
    retry: (count, err) => {
      // Don't retry 403 or 404
      if ((err as ApiError).status === 403 || (err as ApiError).status === 404) return false;
      return count < 2;
    },
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// useTestConnection
// ---------------------------------------------------------------------------

export function useTestConnection() {
  return useMutation<TestConnectionResponse, ApiError, string>({
    mutationFn: (connectionId) =>
      apiFetch<TestConnectionResponse>(
        `/api/v1/integrations/jira/connections/${connectionId}/test`,
        { method: 'POST' },
      ),
  });
}

// ---------------------------------------------------------------------------
// useRotateWebhookSecret
// ---------------------------------------------------------------------------

export function useRotateWebhookSecret() {
  const qc = useQueryClient();
  return useMutation<RotateWebhookSecretResponse, ApiError, string>({
    mutationFn: (connectionId) =>
      apiFetch<RotateWebhookSecretResponse>(
        `/api/v1/integrations/jira/connections/${connectionId}/webhook-secret/rotate`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jiraQueryKeys.health() });
    },
  });
}

// ---------------------------------------------------------------------------
// useJiraProjects — discovery
// ---------------------------------------------------------------------------

export function useJiraProjects(connectionId: string | null) {
  return useQuery<JiraProjectsResponse, ApiError>({
    queryKey: jiraQueryKeys.projects(connectionId ?? ''),
    queryFn: () =>
      apiFetch<JiraProjectsResponse>(
        `/api/v1/integrations/jira/connections/${connectionId}/projects`,
      ),
    enabled: Boolean(connectionId),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// useJiraFields — discovery
// ---------------------------------------------------------------------------

export function useJiraFields(
  connectionId: string | null,
  projectKey: string | null,
  issueTypeId: string | null,
) {
  return useQuery<JiraFieldsResponse, ApiError>({
    queryKey: jiraQueryKeys.fields(connectionId ?? '', projectKey ?? '', issueTypeId ?? ''),
    queryFn: () =>
      apiFetch<JiraFieldsResponse>(
        `/api/v1/integrations/jira/connections/${connectionId}/projects/${projectKey}/issue-types/${issueTypeId}/fields`,
      ),
    enabled: Boolean(connectionId && projectKey && issueTypeId),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// useJiraMappings
// ---------------------------------------------------------------------------

export function useJiraMappings(connectionId?: string) {
  return useQuery<PaginatedMappingsResponse, ApiError>({
    queryKey: jiraQueryKeys.mappings(connectionId),
    queryFn: () => {
      const params = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : '';
      return apiFetch<PaginatedMappingsResponse>(`/api/v1/integrations/jira/mappings${params}`);
    },
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// useSaveMapping — create or update with optimistic concurrency
// ---------------------------------------------------------------------------

export interface SaveMappingInput {
  id?: string;
  connectionId: string;
  projectKey: string;
  projectId: string;
  defaultIssueTypeId: string;
  fieldMap: JiraProjectMapping['fieldMap'];
  statusMap: JiraProjectMapping['statusMap'];
  syncRules: JiraProjectMapping['syncRules'];
  isDefault: boolean;
  enabled: boolean;
  version?: string; // updatedAt of last known row — 409 on mismatch
}

export function useSaveMapping() {
  const qc = useQueryClient();
  return useMutation<MappingResponse, ApiError, SaveMappingInput>({
    mutationFn: ({ id, version, ...payload }) => {
      const method = id ? 'PUT' : 'POST';
      const url = id
        ? `/api/v1/integrations/jira/mappings/${id}`
        : '/api/v1/integrations/jira/mappings';
      const body = id && version ? { ...payload, version } : payload;
      return apiFetch<MappingResponse>(url, { method, body: JSON.stringify(body) });
    },
    onSuccess: (_data, { id, connectionId }) => {
      void qc.invalidateQueries({ queryKey: jiraQueryKeys.mappings(connectionId) });
      if (id) void qc.invalidateQueries({ queryKey: jiraQueryKeys.mapping(id) });
    },
  });
}

// ---------------------------------------------------------------------------
// useDlqPage — cursor-paginated
// ---------------------------------------------------------------------------

export function useDlqPage(connectionId?: string, eventType?: string, pageSize = 25) {
  return useInfiniteQuery<DlqPageResponse, ApiError>({
    queryKey: jiraQueryKeys.dlq(connectionId, eventType),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (connectionId) params.set('connectionId', connectionId);
      if (eventType) params.set('eventType', eventType);
      if (pageParam) params.set('cursor', pageParam as string);
      return apiFetch<DlqPageResponse>(`/api/v1/integrations/jira/dlq?${params.toString()}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------------------
// useReplayDlqItem — single replay
// ---------------------------------------------------------------------------

export function useReplayDlqItem() {
  const qc = useQueryClient();
  return useMutation<ReplayResult, ApiError, string>({
    mutationFn: (eventId) =>
      apiFetch<ReplayResult>(`/api/v1/integrations/jira/dlq/${eventId}/replay`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jiraQueryKeys.dlq() });
      void qc.invalidateQueries({ queryKey: jiraQueryKeys.health() });
    },
  });
}

// ---------------------------------------------------------------------------
// useReplayDlqBatch — capped batch replay (max 50)
// ---------------------------------------------------------------------------

export const DLQ_BATCH_REPLAY_CAP = 50;

export function useReplayDlqBatch() {
  const qc = useQueryClient();
  return useMutation<BatchReplayResponse, ApiError, string[]>({
    mutationFn: (ids) => {
      const capped = ids.slice(0, DLQ_BATCH_REPLAY_CAP);
      return apiFetch<BatchReplayResponse>('/api/v1/integrations/jira/dlq/batch-replay', {
        method: 'POST',
        body: JSON.stringify({ ids: capped }),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jiraQueryKeys.dlq() });
      void qc.invalidateQueries({ queryKey: jiraQueryKeys.health() });
    },
  });
}

// ---------------------------------------------------------------------------
// useReconciliationRuns
// ---------------------------------------------------------------------------

export function useReconciliationRuns(connectionId?: string) {
  return useQuery<ReconciliationRunsResponse, ApiError>({
    queryKey: jiraQueryKeys.reconciliationRuns(connectionId),
    queryFn: () => {
      const params = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : '';
      return apiFetch<ReconciliationRunsResponse>(
        `/api/v1/integrations/jira/reconciliation/runs${params}`,
      );
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
}

// ---------------------------------------------------------------------------
// useTriggerReconciliation
// ---------------------------------------------------------------------------

export interface TriggerReconciliationInput {
  connectionId: string;
  lookbackHours: number;
}

export function useTriggerReconciliation() {
  const qc = useQueryClient();
  return useMutation<TriggerReconciliationResponse, ApiError, TriggerReconciliationInput>({
    mutationFn: (payload) =>
      apiFetch<TriggerReconciliationResponse>(
        '/api/v1/integrations/jira/reconciliation/runs',
        { method: 'POST', body: JSON.stringify(payload) },
      ),
    onSuccess: (_data, { connectionId }) => {
      void qc.invalidateQueries({ queryKey: jiraQueryKeys.reconciliationRuns(connectionId) });
    },
  });
}
