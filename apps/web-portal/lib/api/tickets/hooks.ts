/**
 * Portal ticket React Query hooks — WO-090.
 *
 * Provides:
 *   usePortalTicketList   — paginated ticket list with filters (AC1, AC2)
 *   usePortalTicketDetail — ticket detail with public comments + SLA (AC3)
 *   usePortalAddComment   — forced-public reply with cache invalidation (AC5)
 *   useAttachmentDownload — pre-signed download URL (AC8)
 *
 * Security note:
 *   - No `visibility` field is ever sent in the add-comment request; the server
 *     enforces public visibility regardless of client input.
 *   - 404 responses from the API indicate out-of-scope resources. Components
 *     MUST NOT render 404 as a permission message (existence non-disclosure).
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import type {
  PortalTicketListFilters,
  PortalTicketListResponse,
  PortalTicketDetail,
  PortalAddCommentRequest,
  PortalAddCommentResponse,
  AttachmentDownloadResponse,
} from './types';

// ---------------------------------------------------------------------------
// Query keys — stable, typed, cache-safe
// ---------------------------------------------------------------------------

export const portalTicketKeys = {
  all: ['portalTickets'] as const,
  lists: () => ['portalTickets', 'list'] as const,
  list: (filters: PortalTicketListFilters) =>
    ['portalTickets', 'list', filters] as const,
  details: () => ['portalTickets', 'detail'] as const,
  detail: (id: string) => ['portalTickets', 'detail', id] as const,
  attachmentDownload: (id: string) => ['portalAttachments', 'download', id] as const,
} as const;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Paginated ticket list — AC1, AC2, AC10
 * Applies allow-listed status and q filters, cursor pagination.
 */
export function usePortalTicketList(filters: PortalTicketListFilters = {}) {
  const query: Record<string, string | number | boolean | undefined> = {};
  if (filters.status) query['status'] = filters.status;
  if (filters.q)      query['q']      = filters.q;
  if (filters.cursor) query['cursor'] = filters.cursor;
  if (filters.limit)  query['limit']  = filters.limit;

  return useQuery({
    queryKey: portalTicketKeys.list(filters),
    queryFn:  () =>
      request<PortalTicketListResponse>({ path: '/portal/tickets', query }),
    staleTime: 30_000, // match server-side 30s Redis cache
  });
}

/**
 * Ticket detail — AC3, AC4, AC7
 * Returns only public comments, customer-safe SLA projection and status history.
 * 404 means out-of-scope (not necessarily "does not exist").
 */
export function usePortalTicketDetail(ticketId: string) {
  return useQuery({
    queryKey: portalTicketKeys.detail(ticketId),
    queryFn:  () =>
      request<PortalTicketDetail>({ path: `/portal/tickets/${ticketId}` }),
    enabled:   !!ticketId,
    staleTime: 30_000,
  });
}

/**
 * Add a public reply — AC5, AC6
 * visibility is structurally absent from the request DTO; the server forces it.
 * On 422 TICKET_CLOSED the mutation rejects — the caller should surface the
 * TICKET_CLOSED code with an actionable message.
 */
export function usePortalAddComment(ticketId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (data: PortalAddCommentRequest) =>
      request<PortalAddCommentResponse>({
        method: 'POST',
        path:   `/portal/tickets/${ticketId}/comments`,
        body:   data,
      }),
    onSuccess: () => {
      // Invalidate detail (to reload comment thread) and all lists (status may change)
      void qc.invalidateQueries({ queryKey: portalTicketKeys.detail(ticketId) });
      void qc.invalidateQueries({ queryKey: portalTicketKeys.lists() });
    },
  });
}

/**
 * Attachment pre-signed download URL — AC8
 * Fetches on demand (`refetchOnMount: false`, `enabled` starts false).
 * The URL is valid for 5 minutes; staleTime is set to 4 minutes to avoid serving
 * an expired URL.
 */
export function useAttachmentDownload(attachmentId: string, enabled = false) {
  return useQuery({
    queryKey: portalTicketKeys.attachmentDownload(attachmentId),
    queryFn:  () =>
      request<AttachmentDownloadResponse>({
        path: `/portal/attachments/${attachmentId}/download`,
      }),
    enabled,
    staleTime:         4 * 60 * 1000, // 4 minutes (server issues 5-minute URLs)
    refetchOnMount:    false,
    refetchOnFocus:    false,
    refetchOnReconnect: false,
    retry:             false,          // 404 on ownership failure should not be retried
  });
}
