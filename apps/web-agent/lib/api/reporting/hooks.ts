'use client';

/**
 * TanStack Query hooks for the Report Builder — WO-078.
 *
 * - useFieldCatalog: GET /api/v1/reports/field-catalog, 1h staleTime (catalog is stable)
 * - useReportList: GET /api/v1/reports (definitions)
 * - useRunReport: useMutation with AbortController cancellation
 * - useCreateReport / useUpdateReport / useDeleteReport: CRUD mutations
 * - useRequestExport: POST /api/v1/exports
 *
 * AbortController wiring: the runReport mutation stores the controller in a
 * module-level ref so callers can cancel an in-flight run by calling
 * cancelRun() before issuing a new one.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  FieldCatalogResponse,
  ReportDefinition,
  ReportListResponse,
  RunReportDto,
  RunReportResponse,
  CreateReportDto,
  UpdateReportDto,
  ExportRequestDto,
  ExportRequestResponse,
} from './types';
import { ReportingApiError } from './types';

// ---------------------------------------------------------------------------
// Shared fetch helper
// ---------------------------------------------------------------------------

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = null; }
    const env = body as { error?: { message?: string; code?: string; traceId?: string } } | null;
    throw new ReportingApiError(
      res.status,
      env?.error?.code ?? 'UNKNOWN',
      env?.error?.message ?? `HTTP ${res.status}`,
      env?.error?.traceId ?? null,
    );
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const reportingKeys = {
  all:          ['reporting'] as const,
  catalog:      () => [...reportingKeys.all, 'field-catalog'] as const,
  definitions:  () => [...reportingKeys.all, 'definitions'] as const,
  definition:   (id: string) => [...reportingKeys.definitions(), id] as const,
} as const;

// ---------------------------------------------------------------------------
// Field catalog — long staleTime; catalog rarely changes
// ---------------------------------------------------------------------------

export function useFieldCatalog(): UseQueryResult<FieldCatalogResponse> {
  return useQuery({
    queryKey:  reportingKeys.catalog(),
    queryFn:   () => apiFetch<FieldCatalogResponse>('/api/v1/reports/field-catalog'),
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime:    2 * 60 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Report definitions list
// ---------------------------------------------------------------------------

export function useReportList(): UseQueryResult<ReportDefinition[]> {
  return useQuery({
    queryKey: reportingKeys.definitions(),
    queryFn:  async () => {
      const res = await apiFetch<ReportListResponse>('/api/v1/reports');
      return res.data;
    },
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Run report — mutation with AbortController cancellation
// ---------------------------------------------------------------------------

let activeRunController: AbortController | null = null;

/** Cancel an in-flight run (if any). Call before issuing a new run. */
export function cancelRun(): void {
  activeRunController?.abort();
  activeRunController = null;
}

export function useRunReport() {
  return useMutation<RunReportResponse, ReportingApiError, RunReportDto>({
    mutationFn: async (dto) => {
      cancelRun(); // cancel any previous in-flight run
      activeRunController = new AbortController();
      return apiFetch<RunReportResponse>('/api/v1/reports/run', {
        method: 'POST',
        body:   JSON.stringify(dto),
        signal: activeRunController.signal,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// CRUD mutations
// ---------------------------------------------------------------------------

export function useCreateReport() {
  const qc = useQueryClient();
  return useMutation<ReportDefinition, ReportingApiError, CreateReportDto>({
    mutationFn: (dto) =>
      apiFetch<ReportDefinition>('/api/v1/reports', {
        method: 'POST',
        body:   JSON.stringify(dto),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reportingKeys.definitions() });
    },
  });
}

export function useUpdateReport(id: string) {
  const qc = useQueryClient();
  return useMutation<ReportDefinition, ReportingApiError, UpdateReportDto>({
    mutationFn: (dto) =>
      apiFetch<ReportDefinition>(`/api/v1/reports/${id}`, {
        method: 'PATCH',
        body:   JSON.stringify(dto),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reportingKeys.definitions() });
    },
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation<void, ReportingApiError, string>({
    mutationFn: (id) =>
      apiFetch<void>(`/api/v1/reports/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reportingKeys.definitions() });
    },
  });
}

// ---------------------------------------------------------------------------
// Export request
// ---------------------------------------------------------------------------

export function useRequestExport() {
  return useMutation<ExportRequestResponse, ReportingApiError, ExportRequestDto>({
    mutationFn: (dto) =>
      apiFetch<ExportRequestResponse>('/api/v1/exports', {
        method: 'POST',
        body:   JSON.stringify(dto),
      }),
  });
}
