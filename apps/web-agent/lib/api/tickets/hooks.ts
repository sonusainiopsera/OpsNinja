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
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { computeSignature } from '@opsninja/filter-compiler';
import { apiFetch } from '../fetch';
import type {
  TicketRow,
  TicketListResponse,
  TicketListFilters,
  BulkActionPayload,
  BulkActionResponse,
  TicketDetail,
  TicketDetailResponse,
  CommentListResponse,
  CreateCommentPayload,
  Comment,
  PresignResponse,
  FinalizeAttachmentPayload,
  FinalizeAttachmentResponse,
  UpdateTicketPayload,
  ResolveTicketPayload,
  ResolveTicketResponse,
} from './types';

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
  detail: (id: string) => [...ticketQueryKeys.all, 'detail', id] as const,
  comments: (ticketId: string) => [...ticketQueryKeys.all, 'comments', ticketId] as const,
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

// ---------------------------------------------------------------------------
// Ticket detail hooks — WO-042
// ---------------------------------------------------------------------------

/** Fetch full ticket detail (includes SLA summary, Jira link, AI status). */
export function useTicketDetail(id: string) {
  return useQuery<TicketDetail>({
    queryKey: ticketQueryKeys.detail(id),
    queryFn: () =>
      apiFetch<TicketDetailResponse>(`/api/v1/tickets/${id}`).then((r) => r.data),
    staleTime: 15_000,
    retry: (count, err) => {
      const status = (err as { status?: number }).status;
      // Don't retry 404 or 403
      if (status === 404 || status === 403) return false;
      return count < 2;
    },
  });
}

/** Infinite cursor-paginated comment thread for a ticket. */
export function useTicketComments(ticketId: string) {
  return useInfiniteQuery<CommentListResponse>({
    queryKey: ticketQueryKeys.comments(ticketId),
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as string | undefined;
      const params = new URLSearchParams({ limit: '30' });
      if (cursor) params.set('cursor', cursor);
      return apiFetch<CommentListResponse>(
        `/api/v1/tickets/${ticketId}/comments?${params.toString()}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}

/** Optimistic comment submission — appends immediately, rolls back on failure. */
export function useAddComment(ticketId: string) {
  const qc = useQueryClient();

  return useMutation<Comment, Error, CreateCommentPayload>({
    mutationFn: (payload) =>
      apiFetch<{ data: Comment }>(`/api/v1/tickets/${ticketId}/comments`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ticketQueryKeys.comments(ticketId) });
    },
  });
}

/** Request a presigned upload URL for a new attachment. */
export function usePresignAttachment(ticketId: string) {
  return useMutation<PresignResponse, Error, { filename: string; contentType: string; sizeBytes: number }>({
    mutationFn: (payload) =>
      apiFetch<PresignResponse>(`/api/v1/tickets/${ticketId}/attachments/presign`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  });
}

/** Finalize attachment after direct upload to storage is complete. */
export function useFinalizeAttachment(ticketId: string) {
  return useMutation<FinalizeAttachmentResponse, Error, FinalizeAttachmentPayload>({
    mutationFn: (payload) =>
      apiFetch<FinalizeAttachmentResponse>(
        `/api/v1/tickets/${ticketId}/attachments/finalize`,
        { method: 'POST', body: JSON.stringify(payload) },
      ),
  });
}

/** Update ticket properties (priority, assignee, tags, custom fields) with version. */
export function useUpdateTicket(id: string) {
  const qc = useQueryClient();

  return useMutation<TicketDetail, unknown, UpdateTicketPayload>({
    mutationFn: (payload) =>
      apiFetch<TicketDetailResponse>(`/api/v1/tickets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }).then((r) => r.data),
    onSuccess: (updated) => {
      qc.setQueryData<TicketDetail>(ticketQueryKeys.detail(id), updated);
      void qc.invalidateQueries({ queryKey: ticketQueryKeys.queue({}) });
    },
  });
}

/** Resolve a ticket with a resolution note. */
export function useResolveTicket(id: string) {
  const qc = useQueryClient();

  return useMutation<TicketDetail, unknown, ResolveTicketPayload>({
    mutationFn: (payload) =>
      apiFetch<ResolveTicketResponse>(`/api/v1/tickets/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }).then((r) => r.data),
    onSuccess: (updated) => {
      qc.setQueryData<TicketDetail>(ticketQueryKeys.detail(id), updated);
      void qc.invalidateQueries({ queryKey: ticketQueryKeys.queue({}) });
    },
  });
}
