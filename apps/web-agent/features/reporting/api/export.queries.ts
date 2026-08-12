'use client';

/**
 * Export Jobs — provider, hooks, and utilities (WO-079).
 *
 * Architecture:
 *   ExportJobsProvider   — context holding tracked job IDs + optimistic entries
 *   useCreateExport      — POST /api/v1/exports; adds optimistic entry; reconciles on 202
 *   useExportJobs        — polls tracked jobs with tiered backoff via useQueries
 *   useDownloadExport    — fetches GET /api/v1/exports/{id} fresh at click time; never caches URL
 *
 * Polling tiers (AC-4):
 *   elapsed < 30 s  → refetch every 2 s
 *   elapsed < 5 min → refetch every 5 s
 *   elapsed ≥ 5 min → refetch every 15 s
 *   all terminal    → false (stop polling)
 *   background tab  → false (refetchIntervalInBackground: false)
 *   stuck ceiling   → STUCK_JOB_CEILING_MS (10 min) shows contact-support state
 *
 * Presigned URL constraint (AC-5, Constraints):
 *   downloadUrl is NEVER stored in component state, localStorage, or analytics.
 *   useDownloadExport fetches a fresh URL on every click and discards it after use.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import {
  useMutation,
  useQueryClient,
  useQueries,
} from '@tanstack/react-query';
import type {
  ExportJob,
  ExportJobStatus,
  CreateExportPayload,
  CreateExportResponse,
} from '../../../lib/api/reporting/types';
import { ReportingApiError } from '../../../lib/api/reporting/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STUCK_JOB_CEILING_MS = 10 * 60 * 1_000; // 10 minutes

// ---------------------------------------------------------------------------
// Pure utilities — exported for unit testing
// ---------------------------------------------------------------------------

export function isTerminalStatus(status: ExportJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'expired';
}

/**
 * Compute refetch interval based on how long the job has been pending.
 * Returns false when allTerminal to stop polling.
 */
export function computeBackoff(elapsedMs: number, allTerminal: boolean): number | false {
  if (allTerminal) return false;
  if (elapsedMs < 30_000) return 2_000;
  if (elapsedMs < 300_000) return 5_000;
  return 15_000;
}

/** Format a byte count as a human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_024 * 1_024 * 1_024) return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
  return `${(bytes / (1_024 * 1_024 * 1_024)).toFixed(2)} GB`;
}

/** Format an ISO expiry timestamp as a relative string with absolute tooltip. */
export function formatRelativeExpiry(expiresAt: string): { relative: string; absolute: string } {
  const exp = new Date(expiresAt);
  const now = new Date();
  const diffMs = exp.getTime() - now.getTime();
  const absolute = exp.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  if (diffMs <= 0) return { relative: 'expired', absolute };

  const days = Math.floor(diffMs / (1_000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1_000 * 60 * 60 * 24)) / (1_000 * 60 * 60));
  const mins = Math.floor((diffMs % (1_000 * 60 * 60)) / (1_000 * 60));

  if (days > 1) return { relative: `expires in ${days} days`, absolute };
  if (days === 1) return { relative: 'expires tomorrow', absolute };
  if (hours > 0) return { relative: `expires in ${hours}h`, absolute };
  return { relative: `expires in ${mins}m`, absolute };
}

export const EXPORT_ERROR_COPY: Record<string, string> = {
  EXPORT_QUERY_TIMEOUT:
    'Query timed out. Try narrowing the time range or adding more filters.',
  EXPORT_ROW_LIMIT_EXCEEDED:
    'Too many rows to export. Use CSV format or narrow your filters.',
  EXPORT_RENDER_TIMEOUT:
    'PDF generation timed out. Try exporting as CSV instead.',
  EXPORT_EXPIRED:
    'This export has expired. Click Re-run to create a new export.',
  EXPORT_PERMISSION_DENIED:
    'You do not have permission to download this export.',
  EXPORT_UNKNOWN:
    'Export failed. Please try again or contact support with the trace ID below.',
};

export function getExportErrorCopy(code: string | undefined): string {
  if (!code) return EXPORT_ERROR_COPY['EXPORT_UNKNOWN']!;
  return EXPORT_ERROR_COPY[code] ?? EXPORT_ERROR_COPY['EXPORT_UNKNOWN']!;
}

// ---------------------------------------------------------------------------
// API fetch helper
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
// Optimistic entry type (pending before API responds)
// ---------------------------------------------------------------------------

export interface OptimisticExportJob {
  tempId: string;
  format: 'csv' | 'pdf';
  createdAt: string;
  definition: CreateExportPayload['definition'];
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ExportJobsContextValue {
  /** Real polled job IDs (newest first) */
  trackedIds: string[];
  /** Optimistic entries inserted before API responds */
  optimisticJobs: OptimisticExportJob[];
  addOptimistic: (entry: OptimisticExportJob) => void;
  promoteOptimistic: (tempId: string, realId: string) => void;
  removeOptimistic: (tempId: string) => void;
  addTrackedId: (id: string) => void;
  /** Remove a job from the tray (e.g. user dismisses terminal job) */
  removeTrackedId: (id: string) => void;
}

const ExportJobsContext = createContext<ExportJobsContextValue>({
  trackedIds: [],
  optimisticJobs: [],
  addOptimistic: () => undefined,
  promoteOptimistic: () => undefined,
  removeOptimistic: () => undefined,
  addTrackedId: () => undefined,
  removeTrackedId: () => undefined,
});

export function ExportJobsProvider({ children }: { children: React.ReactNode }) {
  const [trackedIds, setTrackedIds] = useState<string[]>([]);
  const [optimisticJobs, setOptimisticJobs] = useState<OptimisticExportJob[]>([]);

  const addOptimistic = useCallback((entry: OptimisticExportJob) => {
    setOptimisticJobs((prev) => [entry, ...prev]);
  }, []);

  const promoteOptimistic = useCallback((tempId: string, realId: string) => {
    setOptimisticJobs((prev) => prev.filter((j) => j.tempId !== tempId));
    setTrackedIds((prev) => [realId, ...prev.filter((id) => id !== tempId)]);
  }, []);

  const removeOptimistic = useCallback((tempId: string) => {
    setOptimisticJobs((prev) => prev.filter((j) => j.tempId !== tempId));
  }, []);

  const addTrackedId = useCallback((id: string) => {
    setTrackedIds((prev) => (prev.includes(id) ? prev : [id, ...prev]));
  }, []);

  const removeTrackedId = useCallback((id: string) => {
    setTrackedIds((prev) => prev.filter((x) => x !== id));
  }, []);

  return (
    <ExportJobsContext.Provider
      value={{
        trackedIds,
        optimisticJobs,
        addOptimistic,
        promoteOptimistic,
        removeOptimistic,
        addTrackedId,
        removeTrackedId,
      }}
    >
      {children}
    </ExportJobsContext.Provider>
  );
}

export function useExportJobsContext(): ExportJobsContextValue {
  return useContext(ExportJobsContext);
}

// ---------------------------------------------------------------------------
// useExportJobs — polling with tiered backoff
// ---------------------------------------------------------------------------

export interface ExportJobsResult {
  /** Merged list (optimistic entries + polled jobs), newest first */
  jobs: Array<ExportJob | OptimisticExportJob>;
  /** True while any real job is still loading its first response */
  isLoading: boolean;
  /** True if any non-terminal job has exceeded STUCK_JOB_CEILING_MS */
  hasStuckJob: boolean;
  removeJob: (id: string) => void;
}

export function useExportJobs(): ExportJobsResult {
  const { trackedIds, optimisticJobs, removeTrackedId } = useExportJobsContext();

  // Per-job start time ref for backoff calculations
  const startTimesRef = useRef<Map<string, number>>(new Map());

  // Record start times for newly tracked IDs
  trackedIds.forEach((id) => {
    if (!startTimesRef.current.has(id)) {
      startTimesRef.current.set(id, Date.now());
    }
  });

  const queryResults = useQueries({
    queries: trackedIds.map((id) => ({
      queryKey: ['export-job', id] as const,
      queryFn: () => apiFetch<ExportJob>(`/api/v1/exports/${id}`),
      refetchInterval: (query: { state: { data?: ExportJob } }) => {
        const job = query.state.data;
        if (!job) return 2_000; // not yet loaded — poll fast
        if (isTerminalStatus(job.status)) return false; // stop
        const elapsed = Date.now() - (startTimesRef.current.get(id) ?? Date.now());
        return computeBackoff(elapsed, false);
      },
      refetchIntervalInBackground: false,
      staleTime: 0,
      retry: (failureCount: number, error: unknown) => {
        // Do not retry 410 (expired) — treat as terminal
        if (error instanceof ReportingApiError && error.status === 410) return false;
        return failureCount < 2;
      },
    })),
  });

  const isLoading = queryResults.some((r) => r.isLoading);

  const polledJobs: ExportJob[] = queryResults
    .map((r) => r.data)
    .filter((d): d is ExportJob => d !== undefined);

  const hasStuckJob = polledJobs.some((job) => {
    if (isTerminalStatus(job.status)) return false;
    const elapsed = Date.now() - (startTimesRef.current.get(job.id) ?? Date.now());
    return elapsed > STUCK_JOB_CEILING_MS;
  });

  // Merge: optimistic entries first (they're newest), then polled jobs
  const jobs: Array<ExportJob | OptimisticExportJob> = [
    ...optimisticJobs,
    ...polledJobs.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
  ];

  return { jobs, isLoading, hasStuckJob, removeJob: removeTrackedId };
}

// ---------------------------------------------------------------------------
// useCreateExport — POST /api/v1/exports with optimistic insertion
// ---------------------------------------------------------------------------

export function useCreateExport() {
  const {
    addOptimistic,
    promoteOptimistic,
    removeOptimistic,
  } = useExportJobsContext();

  let tempIdCounter = 0;

  return useMutation<CreateExportResponse, ReportingApiError, CreateExportPayload>({
    mutationFn: (payload) =>
      apiFetch<CreateExportResponse>('/api/v1/exports', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onMutate: (payload) => {
      const tempId = `optimistic-${Date.now()}-${++tempIdCounter}`;
      addOptimistic({
        tempId,
        format: payload.format,
        createdAt: new Date().toISOString(),
        definition: payload.definition,
      });
      return { tempId };
    },
    onSuccess: (response, _payload, context) => {
      const ctx = context as { tempId: string } | undefined;
      if (ctx?.tempId) {
        promoteOptimistic(ctx.tempId, response.jobId);
      }
    },
    onError: (_error, _payload, context) => {
      const ctx = context as { tempId: string } | undefined;
      if (ctx?.tempId) {
        removeOptimistic(ctx.tempId);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// useDownloadExport — fetch fresh presigned URL at click time
//
// INVARIANT: the URL is never stored in component state, localStorage,
// sessionStorage, or analytics payloads. It exists only in the call stack
// of this function long enough to trigger the browser download.
// ---------------------------------------------------------------------------

export function useDownloadExport() {
  const qc = useQueryClient();

  return useMutation<void, ReportingApiError, string>({
    mutationFn: async (jobId: string) => {
      // Fetch fresh — never use cached downloadUrl
      const freshJob = await apiFetch<ExportJob>(`/api/v1/exports/${jobId}`);

      if (!freshJob.downloadUrl) {
        // Job may have just expired — invalidate cached query data
        await qc.invalidateQueries({ queryKey: ['export-job', jobId] });
        throw new ReportingApiError(
          410,
          'EXPORT_EXPIRED',
          'This export has expired. Use Re-run to generate a new one.',
        );
      }

      // Trigger browser download — URL used once, not stored
      const a = document.createElement('a');
      a.href = freshJob.downloadUrl;
      a.download = `export-${jobId}.${freshJob.format}`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // freshJob.downloadUrl is now out of scope and will be GC'd
    },
    retry: (failureCount, error) => {
      // Retry once on 403 (URL may have expired at the exact moment of click)
      if (error instanceof ReportingApiError && error.status === 403 && failureCount === 0) {
        return true;
      }
      return false;
    },
  });
}
