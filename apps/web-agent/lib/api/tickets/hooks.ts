'use client';

/**
 * TanStack Query hooks for the ticket queue — WO-041.
 *
 * - useTicketQueue: infinite cursor-based pagination, 30s staleTime,
 *   stale-result-set detection via resultSetVersion
 * - useBulkAction: chunked batch submission with per-row results
 */

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { computeSignature } from '@opsninja/filter-compiler';
import type {
  TicketRow,
  TicketListResponse,
  TicketListFilters,
  BulkActionPayload,
  BulkActionResponse,
} from './types';

// ---------------------------------------------------------------------------
// Fetch helper
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
    const envelope = body as { error?: { message?: string; code?: string; traceId?: string } } | null;
    throw Object.assign(
      new Error(envelope?.error?.message ?? `HTTP ${res.status}`),
      { status: res.status, body, code: envelope?.error?.code, traceId: envelope?.error?.traceId },
    );
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const ticketQueryKeys = {
  all: ['tickets'] as const,
  queue: (filters: Omit<TicketListFilters, 'cursor'>) => {
    // Include filter signature in the key for stable identity
    const filterSig = filters.filter ? computeSignature(filters.filter) : null;
    return [...ticketQueryKeys.all, 'queue', {
      viewId: filters.viewId,
      filterSig,
      sort: filters.sort,
      sortDir: filters.sortDir,
    }] as const;
  },
};

// ---------------------------------------------------------------------------
// useTicketQueue — infinite cursor-pagination with stale-set detection
// ---------------------------------------------------------------------------

export function useTicketQueue(filters: Omit<TicketListFilters, 'cursor'>) {
  return useInfiniteQuery<TicketListResponse>({
    queryKey: ticketQueryKeys.queue(filters),
    queryFn: async ({ pageParam }) => {
      const cursor = (pageParam as string | undefined) ?? undefined;
      const params = new URLSearchParams();
      if (filters.viewId) params.set('viewId', filters.viewId);
      if (filters.filter) params.set('filter', JSON.stringify(filters.filter));
      if (filters.sort) params.set('sort', filters.sort);
      if (filters.sortDir) params.set('sortDir', filters.sortDir);
      if (cursor) params.set('cursor', cursor);
      if (filters.limit) params.set('limit', String(filters.limit));
      const qs = params.toString();
      return apiFetch<TicketListResponse>(`/api/v1/tickets${qs ? `?${qs}` : ''}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 30_000,
    // De-duplicate rows by ticket id when merging pages
    select: (data) => {
      const seen = new Set<string>();
      const pages = data.pages.map((page) => ({
        ...page,
        data: page.data.filter((row) => {
          if (seen.has(row.id)) return false;
          seen.add(row.id);
          return true;
        }),
      }));
      return { ...data, pages };
    },
  });
}

/** Flatten infinite pages into a single row array. */
export function flattenQueuePages(
  data: ReturnType<typeof useTicketQueue>['data'],
): TicketRow[] {
  return data?.pages.flatMap((p) => p.data) ?? [];
}

/** Detect whether the underlying result set has changed across fetches. */
export function detectStaleResultSet(
  data: ReturnType<typeof useTicketQueue>['data'],
): boolean {
  if (!data || data.pages.length < 2) return false;
  const first = data.pages[0]?.resultSetVersion;
  return data.pages.some((p) => p.resultSetVersion !== first);
}

// ---------------------------------------------------------------------------
// useBulkAction — chunked submission with per-row results
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 50; // tickets per API call
const CONCURRENCY = 3; // parallel calls

async function submitChunk(payload: BulkActionPayload): Promise<BulkActionResponse> {
  return apiFetch<BulkActionResponse>('/api/v1/tickets/bulk', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function useBulkAction() {
  const qc = useQueryClient();

  return useMutation<BulkActionResponse, Error, BulkActionPayload>({
    mutationFn: async (payload) => {
      const { ticketIds, ...rest } = payload;

      // Split into chunks
      const chunks: string[][] = [];
      for (let i = 0; i < ticketIds.length; i += CHUNK_SIZE) {
        chunks.push(ticketIds.slice(i, i + CHUNK_SIZE));
      }

      // Process with concurrency limit
      const allResults: BulkActionResponse['results'] = [];
      let chunkIdx = 0;

      async function processNext(): Promise<void> {
        const myIdx = chunkIdx++;
        if (myIdx >= chunks.length) return;
        const chunk = chunks[myIdx]!;
        const res = await submitChunk({ ...rest, ticketIds: chunk });
        allResults.push(...res.results);
        await processNext();
      }

      const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, () =>
        processNext(),
      );
      await Promise.all(workers);

      return {
        results: allResults,
        succeeded: allResults.filter((r) => r.success).length,
        failed: allResults.filter((r) => !r.success).length,
      };
    },
    onSuccess: () => {
      // Invalidate ticket queue so rows refresh with updated state
      void qc.invalidateQueries({ queryKey: ticketQueryKeys.all });
    },
  });
}
